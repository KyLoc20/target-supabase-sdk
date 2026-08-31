import type { LogEntry } from "../core/log-manager";
import { computeLogBatchIdempotencyKey } from "../upload/batch-id";
import type { LogSpoolProcessRole } from "./interface";

/** `role.timestamp.hash.tmp|json` — role is lowercase alphanumeric + hyphen. */
const BATCH_FILE_PATTERN = /^([a-z][a-z0-9-]*)\.(\d{14})\.([a-f0-9]{8})\.(tmp|json)$/;

export function formatLogSpoolBatchTimestamp(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}` +
        `${pad(d.getMonth() + 1)}` +
        `${pad(d.getDate())}` +
        `${pad(d.getHours())}` +
        `${pad(d.getMinutes())}` +
        `${pad(d.getSeconds())}`
    );
}

export function computeLogSpoolShortHash(input: {
    serviceValue: string;
    serviceId: string;
    processRole: LogSpoolProcessRole;
    entries: LogEntry[];
}): string {
    const processKey = `${input.serviceId}:${input.processRole}`;
    const idempotencyKey = computeLogBatchIdempotencyKey({
        service: input.serviceValue,
        process: processKey,
        lane: "slow",
        entries: input.entries,
    });
    return idempotencyKey.slice(0, 8);
}

export function buildLogSpoolBatchBaseName(input: {
    processRole: LogSpoolProcessRole;
    firstEntryTimestamp: number;
    shortHash: string;
}): string {
    const ts = formatLogSpoolBatchTimestamp(input.firstEntryTimestamp);
    return `${input.processRole}.${ts}.${input.shortHash}`;
}

export function parseLogSpoolBatchFilename(filename: string): {
    processRole: LogSpoolProcessRole;
    timestampMs: number;
    shortHash: string;
    extension: "tmp" | "json";
} | null {
    const match = BATCH_FILE_PATTERN.exec(filename);
    if (match == null) {
        return null;
    }

    const processRole = match[1] as LogSpoolProcessRole;
    const tsRaw = match[2];
    const shortHash = match[3];
    const extension = match[4] as "tmp" | "json";

    const year = Number(tsRaw.slice(0, 4));
    const month = Number(tsRaw.slice(4, 6));
    const day = Number(tsRaw.slice(6, 8));
    const hour = Number(tsRaw.slice(8, 10));
    const minute = Number(tsRaw.slice(10, 12));
    const second = Number(tsRaw.slice(12, 14));
    const timestampMs = Date.UTC(year, month - 1, day, hour, minute, second);

    if (!Number.isFinite(timestampMs)) {
        return null;
    }

    return { processRole, timestampMs, shortHash, extension };
}
