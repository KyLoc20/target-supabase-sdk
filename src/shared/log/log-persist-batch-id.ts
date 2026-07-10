import { createHash } from "node:crypto";
import type { LogEntry } from "./log-manager";
import type { LogPersistLane } from "./log-persist.interface";

const BATCH_ID_VERSION = 1;

/** Stable subset of LogEntry for idempotency hashing (same batch → same key). */
function canonicalLogEntry(entry: LogEntry): Record<string, unknown> {
    return {
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        topic: entry.topic,
        module: entry.module,
        traceId: entry.traceId,
        traceParentId: entry.traceParentId ?? null,
        extra: entry.extra ?? null,
        data: entry.data ?? null,
        labels: entry.labels ?? null,
    };
}

/**
 * Deterministic List.value for a log batch — retries after timeout map to the same row key.
 * SHA-256 over canonical JSON (service + process + lane + entries in order).
 */
export function computeLogBatchIdempotencyKey(input: {
    service: string;
    process: string;
    lane: LogPersistLane;
    entries: LogEntry[];
}): string {
    const payload = {
        v: BATCH_ID_VERSION,
        service: input.service,
        process: input.process,
        lane: input.lane,
        entries: input.entries.map(canonicalLogEntry),
    };

    const hash = createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
    return `${hash.slice(0, 32)}`;
}
