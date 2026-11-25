import type { LogEntry } from "./manager/telemetry-manager";

export type TelemetryLane = "log" | "call";

export interface CallEntry {
    ts: number;
    op: string;
    ok: boolean;
    costMs: number;
    errMessage: string | null;
    resultSummary: string | null;
    module: string | null;
    traceId: string | null;
    extra: string | null;
    /**
     * Transport / HTTP status when known (e.g. PostgREST or Express).
     * SDK `core.api` wrappers typically leave this `null` until measured.
     */
    transportStatus: number | null;
    /** Request-side payload bytes when known; otherwise `null`. */
    reqBytes: number | null;
    /** Response-side payload bytes when known; otherwise `null`. */
    respBytes: number | null;
}

export interface TelemetryBatchFilePayload {
    lane: TelemetryLane;
    flushedAt: number;
    sdkVersion: string;
    droppedBeforeFlush: number;
    entries: LogEntry[] | CallEntry[];
}

export interface ListTelemetryBatchesInput {
    lane: TelemetryLane;
    limit?: number;
    sinceMs?: number;
    untilMs?: number;
}

export interface TelemetryBatchMeta {
    lane: TelemetryLane;
    path: string;
    flushedAt: number;
    bytes: number;
}

export interface ReadTelemetryBatchInput {
    lane: TelemetryLane;
    pathOrName: string;
}

export interface GcTelemetryInput {
    lane?: TelemetryLane;
    mode?: "max-bytes" | "max-age" | "all";
    olderThanMs?: number;
    maxBytes?: number;
}

export interface GcTelemetryResult {
    deletedFiles: number;
    freedBytes: number;
    lane: TelemetryLane | "all";
}

export interface TelemetryLaneStats {
    buffered: number;
    dropped: number;
    flushInFlight: boolean;
    lastFlushAt: number;
    diskBytes: number | null;
}

export interface TelemetryStats {
    persistEnabled: boolean;
    root: string | null;
    log: TelemetryLaneStats;
    call: TelemetryLaneStats;
}

export const CALL_ERR_MESSAGE_MAX = 512;
export const CALL_RESULT_SUMMARY_MAX = 128;
export const CALL_EXTRA_MAX = 64;
export const LOG_ENTRY_DATA_JSON_MAX = 4096;

/** Keep in sync with package.json version. */
export const TELEMETRY_SDK_VERSION = "0.3.4";
