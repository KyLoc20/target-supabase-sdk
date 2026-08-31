/**
 * Read side of the log-persist pipeline: decode persisted `LogBatch` Lists into
 * structured batches and flat entries. Pure and defensive — malformed rows are
 * skipped rather than thrown. Mirrors the write side in `upload/flush.ts`.
 */

import type { List } from "../../../list/list.interface";
import type { LogEntry } from "../core/log-manager";
import { LOG_PERSIST_LOADER_KEY, type LogBatchMeta, type LogPersistLane } from "../upload/interface";

const LANES: ReadonlySet<string> = new Set<LogPersistLane>(["fast", "medium", "slow"]);

/** A decoded log batch: origin metadata plus its raw entries. */
export interface DecodedLogBatch {
    /** Source `List` row id. */
    listId: string;
    /** `List.created_at` (ISO string). */
    createdAt: string;
    meta: LogBatchMeta;
    entries: LogEntry[];
}

/** A single {@link LogEntry} enriched with its batch-level origin fields. */
export interface FlatLogEntry extends LogEntry {
    service: string;
    process: string;
    lane: LogPersistLane;
    pid: number;
    /** Idempotency key of the source batch. */
    batchId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

/** Parse `ListDetails.meta` (object or legacy JSON string) into typed batch meta, or null. */
export function parseLogBatchMeta(rawMeta: unknown): LogBatchMeta | null {
    let source: Record<string, unknown> | null;
    if (typeof rawMeta === "string") {
        try {
            source = asRecord(JSON.parse(rawMeta));
        } catch {
            return null;
        }
    } else {
        source = asRecord(rawMeta);
    }
    if (source == null) {
        return null;
    }

    const service = asString(source.service);
    const processName = asString(source.process);
    const laneRaw = asString(source.lane);
    const idempotencyKey = asString(source.idempotencyKey);
    if (service == null || processName == null || laneRaw == null || !LANES.has(laneRaw) || idempotencyKey == null) {
        return null;
    }

    return {
        service,
        process: processName,
        lane: laneRaw as LogPersistLane,
        pid: asFiniteNumber(source.pid) ?? 0,
        count: asFiniteNumber(source.count) ?? 0,
        from: asFiniteNumber(source.from),
        to: asFiniteNumber(source.to),
        flushedAt: asFiniteNumber(source.flushedAt) ?? 0,
        idempotencyKey,
    };
}

/** Structural guard for a persisted {@link LogEntry}. */
export function isLogEntry(value: unknown): value is LogEntry {
    const record = asRecord(value);
    return (
        record != null &&
        typeof record.timestamp === "number" &&
        typeof record.level === "string" &&
        typeof record.message === "string" &&
        typeof record.topic === "string" &&
        typeof record.module === "string" &&
        typeof record.traceId === "string"
    );
}

/** Is this List a persisted log batch (by loaderKey)? */
export function isLogBatchList(list: List): boolean {
    return list.details?.loaderKey === LOG_PERSIST_LOADER_KEY;
}

/**
 * Decode a `List` row into a {@link DecodedLogBatch}. Returns null when the row
 * is not a log batch or the meta/items are malformed.
 */
export function decodeLogBatch(list: List): DecodedLogBatch | null {
    if (!isLogBatchList(list)) {
        return null;
    }
    const meta = parseLogBatchMeta(list.details?.meta);
    if (meta == null) {
        return null;
    }

    const items = Array.isArray(list.details?.items) ? list.details.items : [];
    const entries = items.filter(isLogEntry);

    return {
        listId: list.id,
        createdAt: list.created_at,
        meta,
        entries,
    };
}

/** Decode many List rows, dropping any that are not valid log batches. */
export function decodeLogBatchList(lists: readonly List[]): DecodedLogBatch[] {
    const decoded: DecodedLogBatch[] = [];
    for (const list of lists) {
        const batch = decodeLogBatch(list);
        if (batch != null) {
            decoded.push(batch);
        }
    }
    return decoded;
}

/** Flatten one batch into per-entry rows carrying the batch origin fields. */
export function flattenLogBatch(batch: DecodedLogBatch): FlatLogEntry[] {
    return batch.entries.map((entry) => ({
        ...entry,
        service: batch.meta.service,
        process: batch.meta.process,
        lane: batch.meta.lane,
        pid: batch.meta.pid,
        batchId: batch.meta.idempotencyKey,
    }));
}

/** Flatten many batches into a single flat entry list. */
export function flattenLogBatches(batches: readonly DecodedLogBatch[]): FlatLogEntry[] {
    const flat: FlatLogEntry[] = [];
    for (const batch of batches) {
        flat.push(...flattenLogBatch(batch));
    }
    return flat;
}
