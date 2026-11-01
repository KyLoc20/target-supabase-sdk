import { formatLogSpoolBatchTimestamp } from "./batch-timestamp";
import type { LogSpoolProcessRole } from "./interface";

/** `role.timestamp.hash.tmp|json` — role is lowercase alphanumeric + hyphen. */
const BATCH_FILE_PATTERN = /^([a-z][a-z0-9-]*)\.(\d{14})\.([a-f0-9]{8})\.(tmp|json|synced)$/;

export { formatLogSpoolBatchTimestamp } from "./batch-timestamp";

export function randomLogSpoolShortId(): string {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
    extension: "tmp" | "json" | "synced";
} | null {
    const match = BATCH_FILE_PATTERN.exec(filename);
    if (match == null) {
        return null;
    }

    const processRole = match[1] as LogSpoolProcessRole;
    const tsRaw = match[2];
    const shortHash = match[3];
    const extension = match[4] as "tmp" | "json" | "synced";

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
