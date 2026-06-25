import { Target } from "../core.interface";
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
