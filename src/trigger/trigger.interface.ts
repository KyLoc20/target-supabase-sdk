import type { LoggerWithScope } from "../shared/log";

/** Context passed to each runner invocation. */
export interface TriggerRunnerContext {
    loopTraceId: string;
    nodeId: string;
    runnerKey: string;
    logger: LoggerWithScope;
    /** 1-based attempt index within this tick (includes retries). */
    attempt: number;
    maxAttempts: number;
}

export type TriggerRunnerFn = (ctx: TriggerRunnerContext) => void | Promise<void>;

export interface RegisterTriggerRunnerOptions {
    /** Unique runner key within this process (trimmed; must be non-empty). */
    key: string;
    /** Minimum ms between tick starts for this runner. */
    intervalMs: number;
    fn: TriggerRunnerFn;
    /** Delay first run after registration. Default `0`. */
    initialDelayMs?: number;
    /**
     * Extra attempts after the first failure within the same tick.
     * Default {@link TRIGGER_RUNNER_DEFAULT_RETRY_COUNT} from `./trigger.constant`.
     */
    retryCount?: number;
    /**
     * Delay between retry attempts within the same tick (ms).
     * Default {@link TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS} (`0` = immediate).
     */
    retryDelayMs?: number;
    /**
     * Max ms per fn invocation; rejects when exceeded.
     * Does not cancel in-flight work — fn may still run after timeout. Omit for no limit.
     */
    timeoutMs?: number;
}

/** Options for {@link TriggerNode}. */
export interface TriggerNodeOptions {
    /**
     * When true, bootstrap aborts if no runners were registered before `start()`.
     * Default `false` (warn and idle loop).
     */
    requireRunners?: boolean;
    /**
     * Main loop tick interval (ms). Runners are evaluated each tick; effective runner
     * precision is bounded by this value. Default {@link TRIGGER_LOOP_INTERVAL_MS} (60s).
     */
    loopIntervalMs?: number;
    /**
     * Called after node logout, immediately before `process.exit`.
     * Typical use: {@link unregisterServiceAtShutdown} for single-process L3 services.
     */
    beforeProcessExit?: () => void | Promise<void>;
}
