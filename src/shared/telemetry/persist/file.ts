import { createHash } from "node:crypto";

export function hash6(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 6);
}

/** `{flushedAt}.{pid}.{hash6}.json` */
export function buildTelemetryBatchFileName(flushedAt: number, pid: number, body: string): string {
    return `${flushedAt}.${pid}.${hash6(body)}.json`;
}

export function parseTelemetryBatchFileName(name: string): { flushedAt: number; pid: number; hash6: string } | null {
    const m = /^(\d+)\.(\d+)\.([a-f0-9]{6})\.json$/i.exec(name);
    if (m == null) {
        return null;
    }
    return {
        flushedAt: Number(m[1]),
        pid: Number(m[2]),
        hash6: m[3].toLowerCase(),
    };
}
