import { Target } from "../core.interface";
import type { LoggerWithScope } from "../shared/log";
import { TaskStatus } from "../task/task.interface";

export enum CategoryTrigger {
    TRIGGER = "trigger",
}

export enum TriggerStatus {
    ENABLED = "ENABLED",
    DISABLED = "DISABLED",
    PAUSED = "PAUSED",
}

/** Phase 1: daily fire at `hour`:`minute` UTC. */
export interface TriggerDailySchedule {
    kind: "daily";
    hour: number;
    minute: number;
}

export type TriggerSchedule = TriggerDailySchedule;

export interface TriggerPostTaskAction {
    kind: "post_task";
    taskTypeKey: string;
    taskParams: unknown;
    taskName?: string;
    taskStatus?: TaskStatus.OPEN | TaskStatus.TODO;
}

export type TriggerAction = TriggerPostTaskAction;

export interface Trigger extends Target {
    /** Human readable */
    name: string;
    /** Unique trigger key */
    value: string;
    details: TriggerDetails;
    category: CategoryTrigger;
}

export interface TriggerDetails {
    manifestVersion: number;
    status: TriggerStatus;
    schedule: TriggerSchedule;
    action: TriggerAction;
    lastFiredAt?: number | null;
    /** Idempotency key for the last successful fire, e.g. `daily:2026-06-18` (UTC date). */
    lastFireKey?: string | null;
}

// ─── TriggerNode local runners ───────────────────────────────────────────────

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
}
