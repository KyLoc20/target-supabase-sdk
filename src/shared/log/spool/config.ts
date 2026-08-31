import { envInt, envMs } from "../../../node/env/env-parsers";
import type { LogSpoolConfig } from "./interface";

export const LOG_SPOOL_SERVICE_ID_ENV = "LOG_SPOOL_SERVICE_ID";

export const DEFAULT_LOG_SPOOL_CONFIG: LogSpoolConfig = {
    writer: {
        maxEntries: 2000,
        maxBytes: 2 * 1024 * 1024,
        flushDebounceMs: 3_000,
        maxAgeMs: 60_000,
        postTimeoutMs: 30_000,
    },
    gc: {
        intervalMs: 24 * 60 * 60 * 1000,
        syncedRetentionMs: 7 * 24 * 60 * 60 * 1000,
        tmpRetentionMs: 7 * 24 * 60 * 60 * 1000,
    },
    collectIntervalMs: 60_000,
};

export function resolveLogSpoolConfig(partial?: Partial<LogSpoolConfig>): LogSpoolConfig {
    const defaults = DEFAULT_LOG_SPOOL_CONFIG;
    return {
        writer: { ...defaults.writer, ...partial?.writer },
        gc: { ...defaults.gc, ...partial?.gc },
        collectIntervalMs: partial?.collectIntervalMs ?? defaults.collectIntervalMs,
    };
}

export function logSpoolConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LogSpoolConfig {
    return resolveLogSpoolConfig({
        writer: {
            maxEntries: envInt("LOG_SPOOL_MAX_ENTRIES", DEFAULT_LOG_SPOOL_CONFIG.writer.maxEntries, { env, min: 1 }),
            maxBytes: envInt("LOG_SPOOL_MAX_BYTES", DEFAULT_LOG_SPOOL_CONFIG.writer.maxBytes, { env, min: 1 }),
            flushDebounceMs: envMs("LOG_SPOOL_FLUSH_DEBOUNCE_MS", DEFAULT_LOG_SPOOL_CONFIG.writer.flushDebounceMs, {
                env,
            }),
            maxAgeMs: envMs("LOG_SPOOL_MAX_AGE_MS", DEFAULT_LOG_SPOOL_CONFIG.writer.maxAgeMs, { env }),
            postTimeoutMs: envMs("LOG_PERSIST_POST_TIMEOUT_MS", DEFAULT_LOG_SPOOL_CONFIG.writer.postTimeoutMs, { env }),
        },
        gc: {
            intervalMs: envMs("LOG_SPOOL_GC_INTERVAL_MS", DEFAULT_LOG_SPOOL_CONFIG.gc.intervalMs, { env }),
            syncedRetentionMs: envMs("LOG_SPOOL_SYNCED_RETENTION_MS", DEFAULT_LOG_SPOOL_CONFIG.gc.syncedRetentionMs, {
                env,
            }),
            tmpRetentionMs: envMs("LOG_SPOOL_TMP_RETENTION_MS", DEFAULT_LOG_SPOOL_CONFIG.gc.tmpRetentionMs, { env }),
        },
        collectIntervalMs: envMs("LOG_SPOOL_COLLECT_INTERVAL_MS", DEFAULT_LOG_SPOOL_CONFIG.collectIntervalMs, { env }),
    });
}

export function logSpoolServiceIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env[LOG_SPOOL_SERVICE_ID_ENV]?.trim();
    return raw != null && raw !== "" ? raw : undefined;
}
