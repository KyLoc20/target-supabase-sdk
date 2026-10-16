import type { TargetDraft } from "../../../core.interface";
import type { List } from "../../../list/list.interface";
import type { LogEntry } from "../core/log-manager";

/** Discriminator on `List.value` and `details.loaderKey` — query by `value` only, not JSON loaderKey. */
export const LOG_BATCH_LIST_VALUE = "log-batch";

/** Legacy transport metadata — fixed `"slow"` for spool uploads. */
export type LogPersistLane = "fast" | "medium" | "slow";

export interface LogBatchMeta {
    service: string;
    process: string;
    pid: number;
    lane: LogPersistLane;
    count: number;
    from: number | null;
    to: number | null;
    flushedAt: number;
}

export interface BuildLogListDraftInput {
    service: string;
    process: string;
    lane: LogPersistLane;
    entries: LogEntry[];
}

export type LogListDraft = TargetDraft<List>;
