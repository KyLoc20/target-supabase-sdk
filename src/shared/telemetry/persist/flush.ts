import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TelemetryPersistConfig } from "../env";
import type { LogEntry } from "../manager/telemetry-manager";
import type { CallEntry, TelemetryBatchFilePayload, TelemetryLane } from "../types";
import { TELEMETRY_SDK_VERSION } from "../types";
import { getTelemetryLaneBuffer, takeTelemetryLaneEntries } from "./buffer";
import { buildTelemetryBatchFileName } from "./file";
import { gcLaneToMaxBytes, measureLaneDiskBytes } from "./gc";
import { telemetryLaneDir } from "./paths";

export interface FlushTelemetryResult {
    lane: TelemetryLane;
    flushed: number;
    path: string | null;
}

async function flushLane(
    lane: TelemetryLane,
    config: TelemetryPersistConfig,
    root: string,
): Promise<FlushTelemetryResult> {
    const state = getTelemetryLaneBuffer(lane);
    if (state.flushInFlight || state.entries.length === 0) {
        return { lane, flushed: 0, path: null };
    }

    state.flushInFlight = true;
    try {
        const flushTs = Date.now();
        const { entries, dropped } = takeTelemetryLaneEntries(lane);
        if (entries.length === 0) {
            return { lane, flushed: 0, path: null };
        }

        const diskBefore = await measureLaneDiskBytes(root, lane);
        if (diskBefore != null && diskBefore >= config.maxDiskBytes) {
            await gcLaneToMaxBytes({
                root,
                lane,
                maxBytes: Math.floor(config.maxDiskBytes * config.gcRatio),
            });
        }

        const payload: TelemetryBatchFilePayload = {
            lane,
            flushedAt: flushTs,
            sdkVersion: TELEMETRY_SDK_VERSION,
            droppedBeforeFlush: dropped,
            entries: entries as LogEntry[] | CallEntry[],
        };
        const body = `${JSON.stringify(payload)}\n`;
        const name = buildTelemetryBatchFileName(flushTs, process.pid, body);
        const finalPath = join(telemetryLaneDir(root, lane), name);
        const tmpPath = `${finalPath}.tmp`;

        try {
            await writeFile(tmpPath, body, "utf8");
            await rename(tmpPath, finalPath);
            state.lastFlushAt = flushTs;

            const diskAfter = await measureLaneDiskBytes(root, lane);
            if (diskAfter != null && diskAfter >= config.maxDiskBytes) {
                await gcLaneToMaxBytes({
                    root,
                    lane,
                    maxBytes: Math.floor(config.maxDiskBytes * config.gcRatio),
                });
            }

            return { lane, flushed: entries.length, path: finalPath };
        } catch {
            return { lane, flushed: 0, path: null };
        }
    } finally {
        state.flushInFlight = false;
    }
}

export async function flushTelemetryLanes(
    config: TelemetryPersistConfig,
    root: string,
    lane?: TelemetryLane,
): Promise<FlushTelemetryResult[]> {
    const lanes: TelemetryLane[] = lane == null ? ["log", "call"] : [lane];
    const results: FlushTelemetryResult[] = [];
    for (const l of lanes) {
        results.push(await flushLane(l, config, root));
    }
    return results;
}
