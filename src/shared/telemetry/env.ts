export const TELEMETRY_ON_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_ON";
export const TELEMETRY_DIR_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_DIR";
export const TELEMETRY_FLUSH_SIZE_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_FLUSH_SIZE";
export const TELEMETRY_FLUSH_MS_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_FLUSH_MS";
export const TELEMETRY_MAX_BUFFER_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_MAX_BUFFER";
export const TELEMETRY_MAX_DISK_BYTES_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_MAX_DISK_BYTES";
export const TELEMETRY_GC_RATIO_ENV = "TARGET_SUPABASE_SDK_TELEMETRY_GC_RATIO";

export const DEFAULT_TELEMETRY_DIR = "data/target-supabase-sdk/telemetry";
export const DEFAULT_TELEMETRY_FLUSH_SIZE = 100;
export const DEFAULT_TELEMETRY_FLUSH_MS = 60_000;
export const DEFAULT_TELEMETRY_MAX_BUFFER = 500;
export const DEFAULT_TELEMETRY_MAX_DISK_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TELEMETRY_GC_RATIO = 0.8;

export function envBoolTrue(raw: string | undefined): boolean {
    if (raw == null) {
        return false;
    }
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "1";
}

export function telemetryOnFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    return envBoolTrue(env[TELEMETRY_ON_ENV]);
}

export function telemetryDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const raw = env[TELEMETRY_DIR_ENV]?.trim();
    return raw != null && raw !== "" ? raw : DEFAULT_TELEMETRY_DIR;
}

function envInt(key: string, fallback: number, env: NodeJS.ProcessEnv): number {
    const raw = env[key]?.trim();
    if (raw == null || raw === "") {
        return fallback;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envFloat(key: string, fallback: number, env: NodeJS.ProcessEnv): number {
    const raw = env[key]?.trim();
    if (raw == null || raw === "") {
        return fallback;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

export interface TelemetryPersistConfig {
    root: string;
    flushSize: number;
    flushMs: number;
    maxBuffer: number;
    maxDiskBytes: number;
    gcRatio: number;
}

export function telemetryPersistConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelemetryPersistConfig {
    return {
        root: telemetryDirFromEnv(env),
        flushSize: envInt(TELEMETRY_FLUSH_SIZE_ENV, DEFAULT_TELEMETRY_FLUSH_SIZE, env),
        flushMs: envInt(TELEMETRY_FLUSH_MS_ENV, DEFAULT_TELEMETRY_FLUSH_MS, env),
        maxBuffer: envInt(TELEMETRY_MAX_BUFFER_ENV, DEFAULT_TELEMETRY_MAX_BUFFER, env),
        maxDiskBytes: envInt(TELEMETRY_MAX_DISK_BYTES_ENV, DEFAULT_TELEMETRY_MAX_DISK_BYTES, env),
        gcRatio: envFloat(TELEMETRY_GC_RATIO_ENV, DEFAULT_TELEMETRY_GC_RATIO, env),
    };
}
