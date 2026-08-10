import { type LogEntry, LogLevel } from "./log-manager";
import { DEFAULT_LOG_PERSIST_CONFIG, resolveLogPersistConfig } from "./log-persist.config";
import type {
    EnableLogPersistOptions,
    LogPersistConfig,
    LogPersistLane,
    LogPersistStats,
} from "./log-persist.interface";
import { computeLogBatchIdempotencyKey } from "./log-persist-batch-id";
import { formatLogPersistError, isPermanentLogPersistError } from "./log-persist-errors";
import { buildLogListDraft, estimateEntriesBytes, postLogBatch, takeEntriesWithinBytes } from "./log-persist-flush";
import { registerLogPersistOffer } from "./log-persist-hook";
import {
    configurePersistLoggerRateLimit,
    isLogPersistInternalTopic,
    patchPersistLoggerScope,
    persistLogger,
} from "./log-persist-logger";
import { heartbeatLogPersistProcess } from "./log-persist-registry";

const HEARTBEAT_INTERVAL_MS = 30_000;

function routeLane(level: LogLevel): LogPersistLane {
    if (level === LogLevel.CRITICAL) {
        return "fast";
    }
    if (level === LogLevel.ERROR || level === LogLevel.SUCCESS) {
        return "medium";
    }
    return "slow";
}

class LogPersist {
    private static instance: LogPersist | null = null;

    private enabled = false;
    private draining = false;
    private service: string | null = null;
    private processName: string | null = null;
    private registryFilePath: string | null = null;
    private config: LogPersistConfig = DEFAULT_LOG_PERSIST_CONFIG;

    private fastQueue: LogEntry[] = [];
    private fastRetryQueue: LogEntry[] = [];
    private mediumQueue: LogEntry[] = [];
    private slowQueue: LogEntry[] = [];

    private mediumDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private slowQueueStartedAt: number | null = null;
    private fastRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private mediumRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private slowRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private lastHeartbeatAt = 0;
    private permanentFailureCount = 0;
    private circuitBreakerTripped = false;

    private laneFlushing: Record<LogPersistLane, boolean> = {
        fast: false,
        medium: false,
        slow: false,
    };

    private consecutiveFailures: Record<LogPersistLane, number> = {
        fast: 0,
        medium: 0,
        slow: 0,
    };

    private lastFlushAt: Record<LogPersistLane, string | null> = {
        fast: null,
        medium: null,
        slow: null,
    };

    private lastError: string | null = null;
    private lastErrorAt: string | null = null;
    private shutdownHookInstalled = false;
    private shutdownPromise: Promise<void> | null = null;

    static getInstance(): LogPersist {
        LogPersist.instance ??= new LogPersist();
        return LogPersist.instance;
    }

    async enable(options: EnableLogPersistOptions): Promise<void> {
        if (this.enabled) {
            persistLogger.warn("log persist core enable skipped — already enabled", {
                service: this.service,
                process: this.processName,
            });
            return;
        }

        this.service = options.service;
        this.processName = options.process;
        this.registryFilePath = options.registryFilePath ?? null;
        this.config = resolveLogPersistConfig(options.config);
        configurePersistLoggerRateLimit(this.config.errorLogRateLimitMs);
        this.draining = false;
        this.shutdownPromise = null;
        this.consecutiveFailures = { fast: 0, medium: 0, slow: 0 };
        this.permanentFailureCount = 0;
        this.circuitBreakerTripped = false;
        this.lastError = null;
        this.lastErrorAt = null;
        this.enabled = true;

        patchPersistLoggerScope({
            service: options.service,
            process: options.process,
        });

        persistLogger.info("log persist core enabled", {
            service: options.service,
            process: options.process,
            registryFilePath: this.registryFilePath,
            config: this.config,
            pid: process.pid,
        });

        registerLogPersistOffer((entry) => {
            this.offer(entry);
        });

        if (this.registryFilePath != null) {
            const { registerLogPersistProcess } = await import("./log-persist-registry");
            await registerLogPersistProcess({
                registryFilePath: this.registryFilePath,
                service: options.service,
                process: options.process,
            });
            this.startHeartbeat();
        }

        this.installShutdownHook();
    }

    async disable(): Promise<void> {
        if (!this.enabled && !this.draining) {
            persistLogger.debug("disable skipped — not enabled");
            return;
        }

        persistLogger.info("log persist core disabling", this.queueSnapshot());
        this.cancelMediumDebounce();
        this.cancelLaneRetryTimers();
        this.stopHeartbeat();
        await this.shutdown();
        persistLogger.info("log persist core disabled");
    }

    offer(entry: LogEntry): void {
        if (isLogPersistInternalTopic(entry.topic)) {
            return;
        }

        if (!this.enabled || this.draining || this.service == null || this.processName == null) {
            return;
        }

        void this.touchRegistryHeartbeat();

        const lane = routeLane(entry.level);

        if (lane === "fast") {
            this.fastQueue.push(entry);
            this.evictFastOverflow();
            void this.flushFast();
            return;
        }

        if (lane === "medium") {
            this.mediumQueue.push(entry);
            this.evictMediumOverflow();
            this.scheduleMediumFlush();
            return;
        }

        this.slowQueue.push(entry);
        if (this.slowQueueStartedAt == null) {
            this.slowQueueStartedAt = Date.now();
        }
        this.evictSlowOverflow();
        this.scheduleSlowFlush();
    }

    getStats(): LogPersistStats {
        return {
            enabled: this.enabled,
            draining: this.draining,
            circuitBreakerTripped: this.circuitBreakerTripped,
            permanentFailureCount: this.permanentFailureCount,
            service: this.service,
            process: this.processName,
            queues: {
                fast: this.fastQueue.length,
                fastRetry: this.fastRetryQueue.length,
                medium: this.mediumQueue.length,
                slow: this.slowQueue.length,
            },
            queueBytes: {
                fast: estimateEntriesBytes(this.fastQueue),
                fastRetry: estimateEntriesBytes(this.fastRetryQueue),
                medium: estimateEntriesBytes(this.mediumQueue),
                slow: estimateEntriesBytes(this.slowQueue),
            },
            mediumDebouncePending: this.mediumDebounceTimer != null,
            laneFlushing: { ...this.laneFlushing },
            consecutiveFailures: { ...this.consecutiveFailures },
            config: this.config,
            lastFlushAt: { ...this.lastFlushAt },
            lastError: this.lastError,
            lastErrorAt: this.lastErrorAt,
        };
    }

    async shutdown(): Promise<void> {
        if (this.shutdownPromise != null) {
            return this.shutdownPromise;
        }

        this.shutdownPromise = this.shutdownInner();
        return this.shutdownPromise;
    }

    private async shutdownInner(): Promise<void> {
        if (this.draining) {
            return;
        }

        this.draining = true;
        this.enabled = false;
        registerLogPersistOffer(null);

        persistLogger.info("shutdown flush started", this.queueSnapshot());

        this.cancelMediumDebounce();
        await this.drainQueues(this.config.shutdownDrainTimeoutMs);

        if (this.registryFilePath != null && this.processName != null) {
            const { unregisterLogPersistProcess } = await import("./log-persist-registry");
            await unregisterLogPersistProcess({
                registryFilePath: this.registryFilePath,
                process: this.processName,
            });
        }

        if (this.hasQueued()) {
            persistLogger.warn("shutdown drain incomplete — queued logs dropped", {
                ...this.queueSnapshot(),
                shutdownDrainTimeoutMs: this.config.shutdownDrainTimeoutMs,
            });
            this.fastQueue = [];
            this.fastRetryQueue = [];
            this.mediumQueue = [];
            this.slowQueue = [];
            this.slowQueueStartedAt = null;
        }

        persistLogger.info("shutdown flush completed", this.queueSnapshot());
    }

    private hasQueued(): boolean {
        return (
            this.fastQueue.length > 0 ||
            this.fastRetryQueue.length > 0 ||
            this.mediumQueue.length > 0 ||
            this.slowQueue.length > 0
        );
    }

    private async drainQueues(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (this.hasQueued() && Date.now() < deadline) {
            await this.flushFast();
            await this.flushMedium();
            await this.flushSlow();
        }
    }

    private recordLaneError(lane: LogPersistLane, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        this.lastErrorAt = new Date().toISOString();
        this.consecutiveFailures[lane] += 1;
    }

    private recordLaneSuccess(lane: LogPersistLane): void {
        this.lastError = null;
        this.consecutiveFailures[lane] = 0;
        this.permanentFailureCount = 0;
    }

    private handleLaneFlushFailure(
        lane: LogPersistLane,
        error: unknown,
        scheduleRetry: () => void,
        logMessage: string,
        context: Record<string, unknown>,
    ): void {
        this.recordLaneError(lane, error);
        const message = this.lastError ?? formatLogPersistError(error);

        if (isPermanentLogPersistError(error)) {
            this.permanentFailureCount += 1;
            if (this.permanentFailureCount >= this.config.circuitBreakerPermanentFailureThreshold) {
                this.tripCircuitBreaker(message);
                return;
            }
        }

        persistLogger.error(logMessage, {
            ...context,
            error: message,
            retryInMs: this.config.laneRetryIntervalMs,
            permanentFailureCount: this.permanentFailureCount,
        });
        scheduleRetry();
    }

    private tripCircuitBreaker(reason: string): void {
        if (this.circuitBreakerTripped) {
            return;
        }
        this.circuitBreakerTripped = true;

        this.cancelMediumDebounce();
        this.cancelLaneRetryTimers();
        this.stopHeartbeat();

        const dropped = this.queueSnapshot();
        this.fastQueue = [];
        this.fastRetryQueue = [];
        this.mediumQueue = [];
        this.slowQueue = [];
        this.slowQueueStartedAt = null;

        this.enabled = false;
        registerLogPersistOffer(null);

        persistLogger.error("circuit breaker tripped — log persist disabled", {
            reason,
            permanentFailureCount: this.permanentFailureCount,
            threshold: this.config.circuitBreakerPermanentFailureThreshold,
            dropped,
        });
    }

    private cancelLaneRetryTimers(): void {
        if (this.fastRetryTimer != null) {
            clearTimeout(this.fastRetryTimer);
            this.fastRetryTimer = null;
        }
        if (this.mediumRetryTimer != null) {
            clearTimeout(this.mediumRetryTimer);
            this.mediumRetryTimer = null;
        }
        if (this.slowRetryTimer != null) {
            clearTimeout(this.slowRetryTimer);
            this.slowRetryTimer = null;
        }
    }

    private scheduleLaneRetry(lane: "fast" | "medium" | "slow", flush: () => void): void {
        const retryMs = this.config.laneRetryIntervalMs;
        const existing =
            lane === "fast" ? this.fastRetryTimer : lane === "medium" ? this.mediumRetryTimer : this.slowRetryTimer;
        if (existing != null) {
            return;
        }

        persistLogger.warn(`${lane} flush retry scheduled`, { retryInMs: retryMs });
        const timer = setTimeout(() => {
            if (lane === "fast") {
                this.fastRetryTimer = null;
            } else if (lane === "medium") {
                this.mediumRetryTimer = null;
            } else {
                this.slowRetryTimer = null;
            }
            persistLogger.debug(`${lane} flush retry timer fired`);
            flush();
        }, retryMs);
        timer.unref?.();

        if (lane === "fast") {
            this.fastRetryTimer = timer;
        } else if (lane === "medium") {
            this.mediumRetryTimer = timer;
        } else {
            this.slowRetryTimer = timer;
        }
    }

    private queueSnapshot(): Record<string, unknown> {
        return {
            queues: {
                fast: this.fastQueue.length,
                fastRetry: this.fastRetryQueue.length,
                medium: this.mediumQueue.length,
                slow: this.slowQueue.length,
            },
            queueBytes: {
                fast: estimateEntriesBytes(this.fastQueue),
                fastRetry: estimateEntriesBytes(this.fastRetryQueue),
                medium: estimateEntriesBytes(this.mediumQueue),
                slow: estimateEntriesBytes(this.slowQueue),
            },
            laneFlushing: { ...this.laneFlushing },
            consecutiveFailures: { ...this.consecutiveFailures },
            lastError: this.lastError,
        };
    }

    private installShutdownHook(): void {
        if (this.shutdownHookInstalled) {
            return;
        }
        this.shutdownHookInstalled = true;

        const handler = (signal: NodeJS.Signals) => {
            persistLogger.info("shutdown signal received", { signal });
            void this.shutdown();
        };
        process.once("SIGTERM", handler);
        process.once("SIGINT", handler);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            void this.touchRegistryHeartbeat(true);
        }, HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref?.();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer != null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private async touchRegistryHeartbeat(force = false): Promise<void> {
        if (this.registryFilePath == null || this.processName == null) {
            return;
        }
        const now = Date.now();
        if (!force && now - this.lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
            return;
        }
        this.lastHeartbeatAt = now;
        await heartbeatLogPersistProcess({
            registryFilePath: this.registryFilePath,
            process: this.processName,
        });
    }

    private scheduleMediumFlush(): void {
        if (this.mediumRetryTimer != null) {
            return;
        }
        const { debounceMs, maxEntries, maxBytes } = this.config.medium;
        const queueBytes = estimateEntriesBytes(this.mediumQueue);
        if (this.mediumQueue.length >= maxEntries || queueBytes >= maxBytes) {
            persistLogger.warn("medium flush scheduled — threshold", {
                reason: this.mediumQueue.length >= maxEntries ? "maxEntries" : "maxBytes",
                queueLength: this.mediumQueue.length,
                maxEntries,
                queueBytes,
                maxBytes,
            });
            this.cancelMediumDebounce();
            void this.flushMedium();
            return;
        }

        if (this.mediumDebounceTimer == null && this.mediumQueue.length > 0) {
            persistLogger.debug("medium flush debounce scheduled", {
                debounceMs,
                queueLength: this.mediumQueue.length,
                queueBytes,
            });
            this.mediumDebounceTimer = setTimeout(() => {
                this.mediumDebounceTimer = null;
                persistLogger.debug("medium flush debounce fired");
                void this.flushMedium();
            }, debounceMs);
            this.mediumDebounceTimer.unref?.();
        }
    }

    private cancelMediumDebounce(): void {
        if (this.mediumDebounceTimer != null) {
            clearTimeout(this.mediumDebounceTimer);
            this.mediumDebounceTimer = null;
            persistLogger.debug("medium flush debounce cancelled");
        }
    }

    private scheduleSlowFlush(): void {
        if (this.slowRetryTimer != null) {
            return;
        }
        const { maxEntries, maxBytes, maxAgeMs } = this.config.slow;
        const queueBytes = estimateEntriesBytes(this.slowQueue);
        const ageMs = this.slowQueueStartedAt != null ? Date.now() - this.slowQueueStartedAt : 0;
        if (this.slowQueue.length >= maxEntries || queueBytes >= maxBytes || ageMs >= maxAgeMs) {
            persistLogger.debug("slow flush scheduled — threshold", {
                reason:
                    this.slowQueue.length >= maxEntries
                        ? "maxEntries"
                        : queueBytes >= maxBytes
                          ? "maxBytes"
                          : "maxAgeMs",
                queueLength: this.slowQueue.length,
                maxEntries,
                queueBytes,
                maxBytes,
                ageMs,
                maxAgeMs,
            });
            void this.flushSlow();
        }
    }

    private evictFastOverflow(): void {
        const { maxBufferEntries } = this.config.fast;
        let evicted = 0;
        while (this.fastQueue.length + this.fastRetryQueue.length > maxBufferEntries) {
            const removed = this.fastQueue.length > 0 ? this.fastQueue.shift() : this.fastRetryQueue.shift();
            evicted += 1;
            persistLogger.warn("fast queue overflow — evicted entry", {
                evictedLevel: removed?.level,
                evictedTopic: removed?.topic,
                fromRetryQueue: this.fastQueue.length === 0,
                maxBufferEntries,
            });
        }
        if (evicted > 0) {
            persistLogger.warn("fast queue overflow summary", { evicted, maxBufferEntries });
        }
    }

    private evictMediumOverflow(): void {
        const { maxBufferEntries } = this.config.medium;
        let evicted = 0;
        while (this.mediumQueue.length > maxBufferEntries) {
            const successIndex = this.mediumQueue.findIndex((entry) => entry.level === LogLevel.SUCCESS);
            const removed = successIndex >= 0 ? this.mediumQueue.splice(successIndex, 1)[0] : this.mediumQueue.shift();
            evicted += 1;
            persistLogger.warn("medium queue overflow — evicted entry", {
                evictedLevel: removed?.level,
                evictedTopic: removed?.topic,
                queueLength: this.mediumQueue.length,
                maxBufferEntries,
            });
        }
        if (evicted > 0) {
            persistLogger.warn("medium queue overflow summary", {
                evicted,
                queueLength: this.mediumQueue.length,
                maxBufferEntries,
            });
        }
    }

    private evictSlowOverflow(): void {
        const { maxBufferEntries } = this.config.slow;
        let evicted = 0;
        while (this.slowQueue.length > maxBufferEntries) {
            const debugIndex = this.slowQueue.findIndex((entry) => entry.level === LogLevel.DEBUG);
            const removed = debugIndex >= 0 ? this.slowQueue.splice(debugIndex, 1)[0] : this.slowQueue.shift();
            evicted += 1;
            persistLogger.warn("slow queue overflow — evicted entry", {
                evictedLevel: removed?.level,
                evictedTopic: removed?.topic,
                queueLength: this.slowQueue.length,
                maxBufferEntries,
            });
        }
        if (evicted > 0) {
            persistLogger.warn("slow queue overflow summary", {
                evicted,
                queueLength: this.slowQueue.length,
                maxBufferEntries,
            });
        }
        if (this.slowQueue.length === 0) {
            this.slowQueueStartedAt = null;
        }
    }

    private async flushFast(): Promise<void> {
        if (this.laneFlushing.fast) {
            persistLogger.debug("fast flush skipped — already flushing");
            return;
        }
        if (this.service == null || this.processName == null) {
            return;
        }

        this.laneFlushing.fast = true;
        try {
            while (this.fastQueue.length > 0 || this.fastRetryQueue.length > 0) {
                const fromRetry = this.fastQueue.length === 0;
                const entry = this.fastQueue.shift() ?? this.fastRetryQueue.shift();
                if (entry == null) {
                    break;
                }

                const idempotencyKey = computeLogBatchIdempotencyKey({
                    service: this.service,
                    process: this.processName,
                    lane: "fast",
                    entries: [entry],
                });

                try {
                    const draft = buildLogListDraft({
                        service: this.service,
                        process: this.processName,
                        lane: "fast",
                        idempotencyKey,
                        entries: [entry],
                    });
                    persistLogger.debug("fast flush posting batch", {
                        idempotencyKey,
                        fromRetry,
                        level: entry.level,
                        topic: entry.topic,
                    });
                    await postLogBatch(draft, this.config.postTimeoutMs);
                    this.lastFlushAt.fast = new Date().toISOString();
                    this.recordLaneSuccess("fast");
                    persistLogger.info("fast lane flushed", {
                        idempotencyKey,
                        level: entry.level,
                        topic: entry.topic,
                        fastRetryRemaining: this.fastRetryQueue.length,
                    });
                } catch (error) {
                    this.fastRetryQueue.push(entry);
                    this.handleLaneFlushFailure(
                        "fast",
                        error,
                        () => this.scheduleLaneRetry("fast", () => void this.flushFast()),
                        "fast flush failed — queued for retry",
                        {
                            idempotencyKey,
                            fastRetryQueue: this.fastRetryQueue.length,
                        },
                    );
                    break;
                }
            }
        } finally {
            this.laneFlushing.fast = false;
        }
    }

    private async flushMedium(): Promise<void> {
        if (this.laneFlushing.medium) {
            persistLogger.debug("medium flush skipped — already flushing");
            return;
        }
        if (this.mediumQueue.length === 0) {
            return;
        }
        if (this.service == null || this.processName == null) {
            return;
        }

        this.laneFlushing.medium = true;
        try {
            while (this.mediumQueue.length > 0) {
                const batch = takeEntriesWithinBytes(this.mediumQueue, this.config.medium.maxBytes);
                if (batch.length === 0) {
                    break;
                }

                const idempotencyKey = computeLogBatchIdempotencyKey({
                    service: this.service,
                    process: this.processName,
                    lane: "medium",
                    entries: batch,
                });
                const batchBytes = estimateEntriesBytes(batch);

                try {
                    persistLogger.debug("medium flush posting batch", {
                        idempotencyKey,
                        batchSize: batch.length,
                        batchBytes,
                        queueRemaining: this.mediumQueue.length,
                    });
                    const draft = buildLogListDraft({
                        service: this.service,
                        process: this.processName,
                        lane: "medium",
                        idempotencyKey,
                        entries: batch,
                    });
                    await postLogBatch(draft, this.config.postTimeoutMs);
                    this.mediumQueue.splice(0, batch.length);
                    this.lastFlushAt.medium = new Date().toISOString();
                    this.recordLaneSuccess("medium");
                    persistLogger.info("medium lane flushed", {
                        idempotencyKey,
                        batchSize: batch.length,
                        batchBytes,
                        queueRemaining: this.mediumQueue.length,
                    });
                } catch (error) {
                    this.handleLaneFlushFailure(
                        "medium",
                        error,
                        () => this.scheduleLaneRetry("medium", () => void this.flushMedium()),
                        "medium flush failed — entries retained",
                        {
                            idempotencyKey,
                            batchSize: batch.length,
                            batchBytes,
                            queueRemaining: this.mediumQueue.length,
                        },
                    );
                    break;
                }
            }
        } finally {
            this.laneFlushing.medium = false;
        }

        if (this.mediumQueue.length > 0 && !this.laneFlushing.medium && this.mediumRetryTimer == null) {
            this.scheduleMediumFlush();
        }
    }

    private async flushSlow(): Promise<void> {
        if (this.laneFlushing.slow) {
            persistLogger.debug("slow flush skipped — already flushing");
            return;
        }
        if (this.slowQueue.length === 0) {
            return;
        }
        if (this.service == null || this.processName == null) {
            return;
        }

        this.laneFlushing.slow = true;
        try {
            while (this.slowQueue.length > 0) {
                const batch = takeEntriesWithinBytes(this.slowQueue, this.config.slow.maxBytes);
                if (batch.length === 0) {
                    break;
                }

                const idempotencyKey = computeLogBatchIdempotencyKey({
                    service: this.service,
                    process: this.processName,
                    lane: "slow",
                    entries: batch,
                });
                const batchBytes = estimateEntriesBytes(batch);

                try {
                    persistLogger.debug("slow flush posting batch", {
                        idempotencyKey,
                        batchSize: batch.length,
                        batchBytes,
                        queueRemaining: this.slowQueue.length,
                    });
                    const draft = buildLogListDraft({
                        service: this.service,
                        process: this.processName,
                        lane: "slow",
                        idempotencyKey,
                        entries: batch,
                    });
                    await postLogBatch(draft, this.config.postTimeoutMs);
                    this.slowQueue.splice(0, batch.length);
                    this.lastFlushAt.slow = new Date().toISOString();
                    this.recordLaneSuccess("slow");
                    persistLogger.info("slow lane flushed", {
                        idempotencyKey,
                        batchSize: batch.length,
                        batchBytes,
                        queueRemaining: this.slowQueue.length,
                    });
                } catch (error) {
                    this.handleLaneFlushFailure(
                        "slow",
                        error,
                        () => this.scheduleLaneRetry("slow", () => void this.flushSlow()),
                        "slow flush failed — entries retained",
                        {
                            idempotencyKey,
                            batchSize: batch.length,
                            batchBytes,
                            queueRemaining: this.slowQueue.length,
                        },
                    );
                    break;
                }
            }

            if (this.slowQueue.length === 0) {
                this.slowQueueStartedAt = null;
            }
        } finally {
            this.laneFlushing.slow = false;
        }

        if (this.slowQueue.length > 0 && !this.laneFlushing.slow && this.slowRetryTimer == null) {
            this.scheduleSlowFlush();
        }
    }
}

export { LogPersist };
