import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type {
    ListTelemetryBatchesInput,
    ReadTelemetryBatchInput,
    TelemetryBatchFilePayload,
    TelemetryBatchMeta,
} from "../types";
import { listLaneJsonFiles } from "./gc";
import { telemetryLaneDir } from "./paths";

export async function listTelemetryBatchesAtRoot(
    root: string,
    input: ListTelemetryBatchesInput,
): Promise<TelemetryBatchMeta[]> {
    try {
        const files = await listLaneJsonFiles(telemetryLaneDir(root, input.lane));
        let filtered = files;
        if (input.sinceMs != null) {
            filtered = filtered.filter((f) => f.flushedAt >= input.sinceMs!);
        }
        if (input.untilMs != null) {
            filtered = filtered.filter((f) => f.flushedAt <= input.untilMs!);
        }
        filtered.sort((a, b) => b.flushedAt - a.flushedAt);
        const limit = input.limit ?? 100;
        return filtered.slice(0, limit).map((f) => ({
            lane: input.lane,
            path: f.path,
            flushedAt: f.flushedAt,
            bytes: f.bytes,
        }));
    } catch {
        return [];
    }
}

export async function readTelemetryBatchAtRoot(
    root: string,
    input: ReadTelemetryBatchInput,
): Promise<TelemetryBatchFilePayload | null> {
    try {
        const name = basename(input.pathOrName);
        const path = isAbsolute(input.pathOrName) ? input.pathOrName : join(telemetryLaneDir(root, input.lane), name);
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw) as TelemetryBatchFilePayload;
        if (parsed.lane !== input.lane || !Array.isArray(parsed.entries)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}
