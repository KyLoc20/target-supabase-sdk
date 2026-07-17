import type { TargetDraft } from "../../core.interface";
import type { List } from "../../list/list.interface";
import type { LogEntry } from "./log-manager";

/**
 * `ListDetails.loaderKey` stamped on every persisted log batch (write + read side).
 * Business type: **LogBatch** (transport flush). Pairs with log-service **LogTrace**
 * (`LogTrace.0`) after rekeying by `traceId`.
 */
export const LOG_PERSIST_LOADER_KEY = "LogBatch.0";

/** Alias for {@link LOG_PERSIST_LOADER_KEY} — preferred when contrasting with LogTrace. */
export const LOG_BATCH_LOADER_KEY = LOG_PERSIST_LOADER_KEY;

/** Persistence lane — maps to List tagList and flush policy. */
export type LogPersistLane = "fast" | "medium" | "slow";

export interface LogPersistFastConfig {
    maxBufferEntries: number;
}

export interface LogPersistMediumConfig {
    debounceMs: number;
    maxEntries: number;
    maxBytes: number;
    maxBufferEntries: number;
}

export interface LogPersistSlowConfig {
    maxEntries: number;
    maxBytes: number;
    maxAgeMs: number;
    maxBufferEntries: number;
}

export interface LogPersistConfig {
    fast: LogPersistFastConfig;
    medium: LogPersistMediumConfig;
    slow: LogPersistSlowConfig;
    /** postListCreate / network ceiling per batch */
    postTimeoutMs: number;
    /** Graceful shutdown drain ceiling */
    shutdownDrainTimeoutMs: number;
}

export interface EnableLogPersistOptions {
    service: string;
    process: string;
    /** Shared registry root directory — all processes use the same path; each writes its own shard file. */
    registryFilePath?: string;
    config?: Partial<LogPersistConfig>;
}

export interface EnsureLogPersistFromEnvOptions {
    /** Overrides LOG_PERSIST_PROCESS when set. */
    process?: string;
    /** Overrides LOG_PERSIST_SERVICE when set. */
    service?: string;
    registryFilePath?: string;
    config?: Partial<LogPersistConfig>;
}

export interface LogPersistProcessRecord {
    pid: number;
    enabledAt: string;
    lastHeartbeatAt: string;
}

export interface LogPersistRegistryState {
    updatedAt: string;
    service: string;
    processes: Record<string, LogPersistProcessRecord>;
}

export interface LogPersistQueueStats {
    fast: number;
    fastRetry: number;
    medium: number;
    slow: number;
}

export interface LogPersistQueueBytesStats {
    fast: number;
    fastRetry: number;
    medium: number;
    slow: number;
}

export interface LogPersistStats {
    enabled: boolean;
    draining: boolean;
    service: string | null;
    process: string | null;
    queues: LogPersistQueueStats;
    queueBytes: LogPersistQueueBytesStats;
    mediumDebouncePending: boolean;
    laneFlushing: Record<LogPersistLane, boolean>;
    consecutiveFailures: Record<LogPersistLane, number>;
    config: LogPersistConfig;
    lastFlushAt: Record<LogPersistLane, string | null>;
    lastError: string | null;
    lastErrorAt: string | null;
}

export interface WaitForLogPersistReadyOptions {
    registryFilePath: string;
    service: string;
    expectedProcesses: string[];
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** Process heartbeat older than this is treated as missing. */
    staleMs?: number;
}

export interface LogPersistReadySnapshot {
    ok: boolean;
    missing: string[];
    stale: string[];
    registered: string[];
}

export interface LogBatchMeta {
    service: string;
    process: string;
    pid: number;
    lane: LogPersistLane;
    count: number;
    from: number | null;
    to: number | null;
    flushedAt: number;
    idempotencyKey: string;
}

export interface BuildLogListDraftInput {
    service: string;
    process: string;
    lane: LogPersistLane;
    idempotencyKey: string;
    entries: LogEntry[];
}

export type LogListDraft = TargetDraft<List>;
