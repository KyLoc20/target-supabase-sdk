import type { TargetDraft } from "../../../core.interface";
import type { List } from "../../../list/list.interface";
import type { LogEntry } from "../core/log-manager";

/**
 * `ListDetails.loaderKey` stamped on every persisted log batch (write + read side).
 * Business type: **LogBatch** (transport flush). Pairs with log-service **LogTrace**
 * (`LogTrace.0`) after rekeying by `traceId`.
 */
export const LOG_PERSIST_LOADER_KEY = "LogBatch.0";

/** Alias for {@link LOG_PERSIST_LOADER_KEY} — preferred when contrasting with LogTrace. */
export const LOG_BATCH_LOADER_KEY = LOG_PERSIST_LOADER_KEY;

/** Legacy transport metadata — fixed `"slow"` for spool uploads; required for downstream decode today. */
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
