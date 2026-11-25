import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { GcTelemetryInput, GcTelemetryResult, TelemetryLane } from "../types";
import { parseTelemetryBatchFileName } from "./file";
import { telemetryLaneDir } from "./paths";

interface LaneFileMeta {
    name: string;
    path: string;
    flushedAt: number;
    bytes: number;
}

async function listLaneJsonFiles(laneDir: string): Promise<LaneFileMeta[]> {
    let names: string[];
    try {
        names = await readdir(laneDir);
    } catch {
        return [];
    }
    const out: LaneFileMeta[] = [];
    for (const name of names) {
        if (!name.endsWith(".json") || name.endsWith(".tmp")) {
            continue;
        }
        const parsed = parseTelemetryBatchFileName(name);
        if (parsed == null) {
            continue;
        }
        const path = join(laneDir, name);
        try {
            const st = await stat(path);
            out.push({ name, path, flushedAt: parsed.flushedAt, bytes: st.size });
        } catch {
            // skip
        }
    }
    return out;
}

export async function measureLaneDiskBytes(root: string, lane: TelemetryLane): Promise<number | null> {
    try {
        const files = await listLaneJsonFiles(telemetryLaneDir(root, lane));
        return files.reduce((sum, f) => sum + f.bytes, 0);
    } catch {
        return null;
    }
}

/** Delete oldest files until total bytes <= targetBytes. */
export async function gcLaneToMaxBytes(options: {
    root: string;
    lane: TelemetryLane;
    maxBytes: number;
}): Promise<GcTelemetryResult> {
    const { root, lane, maxBytes } = options;
    const laneDir = telemetryLaneDir(root, lane);
    const files = await listLaneJsonFiles(laneDir);
    files.sort((a, b) => a.flushedAt - b.flushedAt);

    let total = files.reduce((sum, f) => sum + f.bytes, 0);
    let deletedFiles = 0;
    let freedBytes = 0;

    for (const file of files) {
        if (total <= maxBytes) {
            break;
        }
        try {
            await unlink(file.path);
            total -= file.bytes;
            freedBytes += file.bytes;
            deletedFiles += 1;
        } catch {
            // skip
        }
    }

    return { deletedFiles, freedBytes, lane };
}

export async function gcLaneByAge(options: {
    root: string;
    lane: TelemetryLane;
    olderThanMs: number;
    nowMs?: number;
}): Promise<GcTelemetryResult> {
    const now = options.nowMs ?? Date.now();
    const cutoff = now - options.olderThanMs;
    const files = await listLaneJsonFiles(telemetryLaneDir(options.root, options.lane));
    let deletedFiles = 0;
    let freedBytes = 0;
    for (const file of files) {
        if (file.flushedAt >= cutoff) {
            continue;
        }
        try {
            await unlink(file.path);
            deletedFiles += 1;
            freedBytes += file.bytes;
        } catch {
            // skip
        }
    }
    return { deletedFiles, freedBytes, lane: options.lane };
}

export async function gcLaneAll(options: { root: string; lane: TelemetryLane }): Promise<GcTelemetryResult> {
    const files = await listLaneJsonFiles(telemetryLaneDir(options.root, options.lane));
    let deletedFiles = 0;
    let freedBytes = 0;
    for (const file of files) {
        try {
            await unlink(file.path);
            deletedFiles += 1;
            freedBytes += file.bytes;
        } catch {
            // skip
        }
    }
    return { deletedFiles, freedBytes, lane: options.lane };
}

export async function runGcTelemetry(
    root: string,
    input: GcTelemetryInput,
    defaultMaxBytes: number,
): Promise<GcTelemetryResult> {
    const lanes: TelemetryLane[] = input.lane == null ? ["log", "call"] : [input.lane];
    const mode = input.mode ?? "max-bytes";
    let deletedFiles = 0;
    let freedBytes = 0;

    for (const lane of lanes) {
        let result: GcTelemetryResult;
        if (mode === "all") {
            result = await gcLaneAll({ root, lane });
        } else if (mode === "max-age") {
            if (input.olderThanMs == null || input.olderThanMs <= 0) {
                continue;
            }
            result = await gcLaneByAge({ root, lane, olderThanMs: input.olderThanMs });
        } else {
            result = await gcLaneToMaxBytes({
                root,
                lane,
                maxBytes: input.maxBytes ?? defaultMaxBytes,
            });
        }
        deletedFiles += result.deletedFiles;
        freedBytes += result.freedBytes;
    }

    return {
        deletedFiles,
        freedBytes,
        lane: input.lane ?? "all",
    };
}

export { listLaneJsonFiles };
