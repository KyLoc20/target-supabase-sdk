import { envBool, envInt, envMs } from "../../node/env/env-parsers";
import type { LogPersistConfig } from "./log-persist.interface";

export const DEFAULT_LOG_PERSIST_CONFIG: LogPersistConfig = {
    fast: {
        maxBufferEntries: 500,
    },
    medium: {
        debounceMs: 5_000,
        maxEntries: 20,
        maxBytes: 512 * 1024,
        maxBufferEntries: 1_000,
    },
    slow: {
        maxEntries: 400,
        maxBytes: 512 * 1024,
        maxAgeMs: 120_000,
        maxBufferEntries: 2_000,
    },
    postTimeoutMs: 30_000,
    shutdownDrainTimeoutMs: 15_000,
    laneRetryIntervalMs: 5_000,
    errorLogRateLimitMs: 5_000,
    circuitBreakerPermanentFailureThreshold: 3,
};

export function resolveLogPersistConfig(partial?: Partial<LogPersistConfig>): LogPersistConfig {
    const defaults = DEFAULT_LOG_PERSIST_CONFIG;
    return {
        fast: { ...defaults.fast, ...partial?.fast },
        medium: { ...defaults.medium, ...partial?.medium },
        slow: { ...defaults.slow, ...partial?.slow },
        postTimeoutMs: partial?.postTimeoutMs ?? defaults.postTimeoutMs,
        shutdownDrainTimeoutMs: partial?.shutdownDrainTimeoutMs ?? defaults.shutdownDrainTimeoutMs,
        laneRetryIntervalMs: partial?.laneRetryIntervalMs ?? defaults.laneRetryIntervalMs,
        errorLogRateLimitMs: partial?.errorLogRateLimitMs ?? defaults.errorLogRateLimitMs,
        circuitBreakerPermanentFailureThreshold:
            partial?.circuitBreakerPermanentFailureThreshold ?? defaults.circuitBreakerPermanentFailureThreshold,
    };
}

export function logPersistEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    return envBool("LOG_PERSIST_ENABLED", false, env);
}

export function logPersistServiceFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.LOG_PERSIST_SERVICE?.trim();
    return raw != null && raw !== "" ? raw : undefined;
}

export function logPersistProcessFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.LOG_PERSIST_PROCESS?.trim();
    return raw != null && raw !== "" ? raw : undefined;
}

export function logPersistRegistryDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const configured = env.LOG_PERSIST_REGISTRY_DIR?.trim();
    if (configured != null && configured !== "") {
        return configured;
    }
    const runtime = env.RUNTIME_DATA_DIR?.trim();
    return runtime != null && runtime !== "" ? runtime : undefined;
}

export function logPersistConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LogPersistConfig {
    return resolveLogPersistConfig({
        fast: {
            maxBufferEntries: envInt("LOG_FAST_MAX_BUFFER_ENTRIES", DEFAULT_LOG_PERSIST_CONFIG.fast.maxBufferEntries, {
                env,
                min: 1,
            }),
        },
        medium: {
            debounceMs: envMs("LOG_MEDIUM_DEBOUNCE_MS", DEFAULT_LOG_PERSIST_CONFIG.medium.debounceMs, { env }),
            maxEntries: envInt("LOG_MEDIUM_MAX_ENTRIES", DEFAULT_LOG_PERSIST_CONFIG.medium.maxEntries, {
                env,
                min: 1,
            }),
            maxBytes: envInt("LOG_MEDIUM_MAX_BYTES", DEFAULT_LOG_PERSIST_CONFIG.medium.maxBytes, { env, min: 1 }),
            maxBufferEntries: envInt(
                "LOG_MEDIUM_MAX_BUFFER_ENTRIES",
                DEFAULT_LOG_PERSIST_CONFIG.medium.maxBufferEntries,
                { env, min: 1 },
            ),
        },
        slow: {
            maxEntries: envInt("LOG_SLOW_MAX_ENTRIES", DEFAULT_LOG_PERSIST_CONFIG.slow.maxEntries, { env, min: 1 }),
            maxBytes: envInt("LOG_SLOW_MAX_BYTES", DEFAULT_LOG_PERSIST_CONFIG.slow.maxBytes, { env, min: 1 }),
            maxAgeMs: envMs("LOG_SLOW_MAX_AGE_MS", DEFAULT_LOG_PERSIST_CONFIG.slow.maxAgeMs, { env }),
            maxBufferEntries: envInt("LOG_SLOW_MAX_BUFFER_ENTRIES", DEFAULT_LOG_PERSIST_CONFIG.slow.maxBufferEntries, {
                env,
                min: 1,
            }),
        },
        postTimeoutMs: envMs("LOG_PERSIST_POST_TIMEOUT_MS", DEFAULT_LOG_PERSIST_CONFIG.postTimeoutMs, { env }),
        shutdownDrainTimeoutMs: envMs(
            "LOG_PERSIST_SHUTDOWN_DRAIN_MS",
            DEFAULT_LOG_PERSIST_CONFIG.shutdownDrainTimeoutMs,
            { env },
        ),
        laneRetryIntervalMs: envMs(
            "LOG_PERSIST_LANE_RETRY_MS",
            DEFAULT_LOG_PERSIST_CONFIG.laneRetryIntervalMs,
            { env },
        ),
        errorLogRateLimitMs: envMs(
            "LOG_PERSIST_ERROR_LOG_RATE_LIMIT_MS",
            DEFAULT_LOG_PERSIST_CONFIG.errorLogRateLimitMs,
            { env },
        ),
        circuitBreakerPermanentFailureThreshold: envInt(
            "LOG_PERSIST_CIRCUIT_BREAKER_THRESHOLD",
            DEFAULT_LOG_PERSIST_CONFIG.circuitBreakerPermanentFailureThreshold,
            { env, min: 1 },
        ),
    });
}
