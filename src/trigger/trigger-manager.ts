import type { NodeLoopContext } from "../node/node-runtime.base";
import { createLogger, createScope, withModule } from "../shared/log";
import { getErrorMessage } from "../shared/utils/error.utils";
import {
    LOG_TOPIC_TRIGGER,
    TRIGGER_LOOP_INTERVAL_MS,
    TRIGGER_RUNNER_DEFAULT_RETRY_COUNT,
    TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS,
} from "./trigger.constant";
import type { RegisterTriggerRunnerOptions, TriggerRunnerContext, TriggerRunnerFn } from "./trigger.interface";

export type { RegisterTriggerRunnerOptions, TriggerRunnerContext, TriggerRunnerFn } from "./trigger.interface";

interface TriggerRunnerState {
    key: string;
    intervalMs: number;
    fn: TriggerRunnerFn;
    retryCount: number;
    retryDelayMs: number;
    timeoutMs: number | undefined;
    nextRunAt: number;
    running: boolean;
}

const runnerRegistry = new Map<string, TriggerRunnerState>();
let registrationClosed = false;

function normalizeRunnerKey(key: string): string {
    const normalized = key.trim();
    if (normalized.length === 0) {
        throw new Error("[TriggerManager] key must be a non-empty string");
    }
    return normalized;
}

function tryNormalizeRunnerKey(key: string): string | null {
    const normalized = key.trim();
    return normalized.length > 0 ? normalized : null;
}

function validateRunnerOptions(options: RegisterTriggerRunnerOptions): void {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) {
        throw new Error(`[TriggerManager] intervalMs must be a positive number, got ${options.intervalMs}`);
    }
    const retryCount = options.retryCount ?? TRIGGER_RUNNER_DEFAULT_RETRY_COUNT;
    if (!Number.isInteger(retryCount) || retryCount < 0) {
        throw new Error(`[TriggerManager] retryCount must be a non-negative integer, got ${retryCount}`);
    }
    const initialDelayMs = options.initialDelayMs ?? 0;
    if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) {
        throw new Error(`[TriggerManager] initialDelayMs must be a non-negative number, got ${initialDelayMs}`);
    }
    const retryDelayMs = options.retryDelayMs ?? TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS;
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
        throw new Error(`[TriggerManager] retryDelayMs must be a non-negative number, got ${retryDelayMs}`);
    }
    if (options.timeoutMs != null) {
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) {
            throw new Error(`[TriggerManager] timeoutMs must be a positive number when set, got ${options.timeoutMs}`);
        }
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeRunnerFn(
    fn: TriggerRunnerFn,
    ctx: TriggerRunnerContext,
    timeoutMs: number | undefined,
): Promise<void> {
    if (timeoutMs == null) {
        await fn(ctx);
        return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Runner timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        await Promise.race([Promise.resolve(fn(ctx)), timeoutPromise]);
    } finally {
        if (timeoutHandle != null) {
            clearTimeout(timeoutHandle);
        }
    }
}

/** In-process registry and tick loop for {@link TriggerNode}. */
export const TriggerManager = {
    registerRunner(options: RegisterTriggerRunnerOptions): void {
        if (registrationClosed) {
            throw new Error("[TriggerManager] Registration closed — call registerRunner before TriggerNode.start()");
        }

        const key = normalizeRunnerKey(options.key);
        validateRunnerOptions(options);
        if (typeof options.fn !== "function") {
            throw new Error(`[TriggerManager] fn must be a function (runner key: ${key})`);
        }
        if (runnerRegistry.has(key)) {
            throw new Error(`[TriggerManager] Duplicate runner key: ${key}`);
        }

        const now = Date.now();
        runnerRegistry.set(key, {
            key,
            intervalMs: options.intervalMs,
            fn: options.fn,
            retryCount: options.retryCount ?? TRIGGER_RUNNER_DEFAULT_RETRY_COUNT,
            retryDelayMs: options.retryDelayMs ?? TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS,
            timeoutMs: options.timeoutMs,
            nextRunAt: now + (options.initialDelayMs ?? 0),
            running: false,
        });
    },

    hasRunner(key: string): boolean {
        const normalized = tryNormalizeRunnerKey(key);
        return normalized != null && runnerRegistry.has(normalized);
    },

    unregisterRunner(key: string): boolean {
        const normalized = tryNormalizeRunnerKey(key);
        if (normalized == null) {
            return false;
        }
        const runner = runnerRegistry.get(normalized);
        if (runner == null) {
            return false;
        }
        if (runner.running) {
            throw new Error(`[TriggerManager] Cannot unregister running runner: ${normalized}`);
        }
        return runnerRegistry.delete(normalized);
    },

    getRunnerKeys(): string[] {
        return [...runnerRegistry.keys()];
    },

    getRunnersBelowLoopInterval(
        loopIntervalMs: number = TRIGGER_LOOP_INTERVAL_MS,
    ): Array<{ key: string; intervalMs: number }> {
        return [...runnerRegistry.values()]
            .filter((runner) => runner.intervalMs < loopIntervalMs)
            .map((runner) => ({ key: runner.key, intervalMs: runner.intervalMs }));
    },

    /** Called by TriggerNode during bootstrap — blocks further registerRunner calls. */
    closeRegistration(): void {
        registrationClosed = true;
    },

    /** Re-open registration (tests only). */
    _resetRegistrationForTests(): void {
        registrationClosed = false;
    },

    /**
     * Remove all runners. Throws if any runner is still executing.
     * Wait for in-flight ticks to finish before calling in tests.
     */
    clearRunners(): void {
        for (const runner of runnerRegistry.values()) {
            if (runner.running) {
                throw new Error(`[TriggerManager] Cannot clearRunners while runner is running: ${runner.key}`);
            }
        }
        runnerRegistry.clear();
        registrationClosed = false;
    },

    async tick(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId, nodeId } = ctx;
        const loopScope = createScope({ module: "tickRunners", traceId: loopTraceId, labels: { nodeId } });
        const logger = createLogger({ scope: loopScope });

        const now = Date.now();
        const runners = [...runnerRegistry.values()];
        if (runners.length === 0) {
            logger.debug("無 runner 可調度", { topic: LOG_TOPIC_TRIGGER });
            return;
        }

        // Overlap: if fn is still running when due, skip that tick (no catch-up / backlog).
        // Safe while intervals are large; missed ticks increase if fn duration exceeds intervalMs.
        const dueRunners = runners.filter((runner) => !runner.running && now >= runner.nextRunAt);
        if (dueRunners.length === 0) {
            logger.debug("本輪無到期 runner", { topic: LOG_TOPIC_TRIGGER });
            return;
        }

        logger.debug("調度到期 runner", {
            topic: LOG_TOPIC_TRIGGER,
            data: { due: dueRunners.map((r) => r.key) },
        });

        const results = await Promise.all(dueRunners.map((runner) => runRunner(ctx, runner)));
        const executed = results.filter(Boolean).length;
        if (executed > 0) {
            logger.info("Runner 調度完成", {
                topic: LOG_TOPIC_TRIGGER,
                data: { due: dueRunners.length, executed },
            });
        } else {
            logger.warn("本輪到期 runner 均未成功", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    due: dueRunners.length,
                    runnerKeys: dueRunners.map((r) => r.key),
                },
            });
        }
    },
};

async function runRunner(ctx: NodeLoopContext, runner: TriggerRunnerState): Promise<boolean> {
    const { loopTraceId, nodeId } = ctx;
    if (runner.running) {
        return false;
    }

    runner.running = true;
    const runnerLogger = createLogger({
        scope: withModule(
            createScope({ module: "runRunner", traceId: loopTraceId, labels: { nodeId, runnerKey: runner.key } }),
            runner.key,
        ),
    });

    const maxAttempts = 1 + runner.retryCount;
    let succeeded = false;

    try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                runnerLogger.info("Runner 觸發", {
                    topic: LOG_TOPIC_TRIGGER,
                    data: { attempt, maxAttempts },
                });
                await invokeRunnerFn(
                    runner.fn,
                    {
                        loopTraceId,
                        nodeId,
                        runnerKey: runner.key,
                        logger: runnerLogger,
                        attempt,
                        maxAttempts,
                    },
                    runner.timeoutMs,
                );
                runnerLogger.success("Runner 完成", {
                    topic: LOG_TOPIC_TRIGGER,
                    data: { attempt, maxAttempts },
                });
                succeeded = true;
                break;
            } catch (error) {
                const message = getErrorMessage(error);
                if (attempt < maxAttempts) {
                    runnerLogger.warn("Runner 失敗，準備重試", {
                        topic: LOG_TOPIC_TRIGGER,
                        data: { attempt, maxAttempts, error: message },
                    });
                    if (runner.retryDelayMs > 0) {
                        await delay(runner.retryDelayMs);
                    }
                } else {
                    runnerLogger.error("Runner 重試用盡仍失敗", {
                        topic: LOG_TOPIC_TRIGGER,
                        data: { attempt, maxAttempts, error: message },
                    });
                }
            }
        }
    } finally {
        runner.running = false;
        runner.nextRunAt = Date.now() + runner.intervalMs;
    }

    return succeeded;
}
