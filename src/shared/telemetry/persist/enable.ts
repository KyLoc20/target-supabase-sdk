import { mkdir, unlink, writeFile } from "node:fs/promises";
import { registerTelemetryCallOffer, registerTelemetryLogOffer } from "../call/offer";
import { type TelemetryPersistConfig, telemetryOnFromEnv, telemetryPersistConfigFromEnv } from "../env";
import type { LogEntry } from "../manager/telemetry-manager";
import type {
    CallEntry,
    GcTelemetryInput,
    GcTelemetryResult,
    ListTelemetryBatchesInput,
    ReadTelemetryBatchInput,
    TelemetryBatchFilePayload,
    TelemetryBatchMeta,
    TelemetryLane,
    TelemetryStats,
} from "../types";
import { appendTelemetryEntry, getTelemetryLaneBuffer } from "./buffer";
import { flushTelemetryLanes } from "./flush";
import { measureLaneDiskBytes, runGcTelemetry } from "./gc";
import { resolveTelemetryDataRoot, telemetryLaneDir } from "./paths";
import { listTelemetryBatchesAtRoot, readTelemetryBatchAtRoot } from "./query";

interface PersistRuntime {
    root: string;
    config: TelemetryPersistConfig;
    timer: ReturnType<typeof setInterval> | null;
}

let runtime: PersistRuntime | null = null;
let warnedDirOnce = false;
let resolveInFlight: Promise<boolean> | null = null;

async function probeWritable(root: string): Promise<boolean> {
    try {
        await mkdir(telemetryLaneDir(root, "log"), { recursive: true });
        await mkdir(telemetryLaneDir(root, "call"), { recursive: true });
        const probe = `${root}/.telemetry-probe-${process.pid}-${Date.now()}`;
        await writeFile(probe, "ok", "utf8");
        await unlink(probe);
        return true;
    } catch {
        return false;
    }
}

function clearTimer(): void {
    if (runtime?.timer != null) {
        clearInterval(runtime.timer);
        runtime.timer = null;
    }
}

function maybeFlushBySize(lane: TelemetryLane): void {
    if (runtime == null) {
        return;
    }
    const state = getTelemetryLaneBuffer(lane);
    if (state.entries.length >= runtime.config.flushSize) {
        void flushTelemetryLanes(runtime.config, runtime.root, lane);
    }
}

function startTimer(): void {
    if (runtime == null || runtime.timer != null) {
        return;
    }
    const { config, root } = runtime;
    runtime.timer = setInterval(
        () => {
            if (runtime == null) {
                return;
            }
            for (const lane of ["log", "call"] as const) {
                const state = getTelemetryLaneBuffer(lane);
                if (state.entries.length === 0 || state.flushInFlight) {
                    continue;
                }
                const anchor = state.lastFlushAt > 0 ? state.lastFlushAt : state.oldestBufferedAt;
                if (anchor <= 0) {
                    continue;
                }
                if (Date.now() - anchor >= config.flushMs) {
                    void flushTelemetryLanes(config, root, lane);
                }
            }
        },
        Math.min(config.flushMs, 5_000),
    );
    if (typeof runtime.timer.unref === "function") {
        runtime.timer.unref();
    }
}

function installOffers(config: TelemetryPersistConfig): void {
    registerTelemetryLogOffer((entry: LogEntry) => {
        if (runtime == null) {
            return;
        }
        appendTelemetryEntry("log", entry, config.maxBuffer);
        maybeFlushBySize("log");
    });
    registerTelemetryCallOffer((entry: CallEntry) => {
        if (runtime == null) {
            return;
        }
        appendTelemetryEntry("call", entry, config.maxBuffer);
        maybeFlushBySize("call");
    });
}

function uninstallOffers(): void {
    registerTelemetryLogOffer(null);
    registerTelemetryCallOffer(null);
}

/**
 * Resolve persistEnabled: ON && DIR writable. Idempotent.
 * When OFF, does not create directories.
 */
export async function ensureTelemetryPersistFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    if (runtime != null) {
        return true;
    }
    if (!telemetryOnFromEnv(env)) {
        return false;
    }
    if (resolveInFlight != null) {
        return resolveInFlight;
    }

    resolveInFlight = (async () => {
        try {
            const config = telemetryPersistConfigFromEnv(env);
            const root = resolveTelemetryDataRoot(config.root);
            if (root.trim() === "") {
                return false;
            }
            const ok = await probeWritable(root);
            if (!ok) {
                if (!warnedDirOnce) {
                    warnedDirOnce = true;
                    console.warn(
                        `[telemetry] ${env.TARGET_SUPABASE_SDK_TELEMETRY_ON ? "ON" : ""} but DIR not writable (${root}); persist disabled`,
                    );
                }
                return false;
            }
            runtime = { root, config, timer: null };
            installOffers(config);
            startTimer();
            return true;
        } catch {
            return false;
        } finally {
            resolveInFlight = null;
        }
    })();

    return resolveInFlight;
}

/** Child / main entry: enable when env says so; never throws. */
export async function enableTelemetryPersistFromEnvInChild(): Promise<void> {
    try {
        await ensureTelemetryPersistFromEnv();
    } catch {
        // ignore
    }
}

export function isTelemetryPersistEnabled(): boolean {
    return runtime != null;
}

export async function flushTelemetry(options?: { lane?: TelemetryLane }): Promise<void> {
    try {
        if (runtime == null) {
            return;
        }
        await flushTelemetryLanes(runtime.config, runtime.root, options?.lane);
    } catch {
        // ignore
    }
}

export async function shutdownTelemetryPersist(): Promise<void> {
    try {
        await flushTelemetry();
    } catch {
        // ignore
    }
    clearTimer();
    uninstallOffers();
    runtime = null;
}

export async function listTelemetryBatches(input: ListTelemetryBatchesInput): Promise<TelemetryBatchMeta[]> {
    try {
        if (runtime == null) {
            return [];
        }
        return await listTelemetryBatchesAtRoot(runtime.root, input);
    } catch {
        return [];
    }
}

export async function readTelemetryBatch(input: ReadTelemetryBatchInput): Promise<TelemetryBatchFilePayload | null> {
    try {
        if (runtime == null) {
            return null;
        }
        return await readTelemetryBatchAtRoot(runtime.root, input);
    } catch {
        return null;
    }
}

export async function gcTelemetry(input: GcTelemetryInput = {}): Promise<GcTelemetryResult> {
    try {
        if (runtime == null) {
            return { deletedFiles: 0, freedBytes: 0, lane: input.lane ?? "all" };
        }
        return await runGcTelemetry(runtime.root, input, runtime.config.maxDiskBytes);
    } catch {
        return { deletedFiles: 0, freedBytes: 0, lane: input.lane ?? "all" };
    }
}

export async function getTelemetryStats(): Promise<TelemetryStats> {
    const emptyLane = {
        buffered: 0,
        dropped: 0,
        flushInFlight: false,
        lastFlushAt: 0,
        diskBytes: null as number | null,
    };
    if (runtime == null) {
        return {
            persistEnabled: false,
            root: null,
            log: { ...emptyLane },
            call: { ...emptyLane },
        };
    }
    const logState = getTelemetryLaneBuffer("log");
    const callState = getTelemetryLaneBuffer("call");
    return {
        persistEnabled: true,
        root: runtime.root,
        log: {
            buffered: logState.entries.length,
            dropped: logState.dropped,
            flushInFlight: logState.flushInFlight,
            lastFlushAt: logState.lastFlushAt,
            diskBytes: await measureLaneDiskBytes(runtime.root, "log"),
        },
        call: {
            buffered: callState.entries.length,
            dropped: callState.dropped,
            flushInFlight: callState.flushInFlight,
            lastFlushAt: callState.lastFlushAt,
            diskBytes: await measureLaneDiskBytes(runtime.root, "call"),
        },
    };
}
