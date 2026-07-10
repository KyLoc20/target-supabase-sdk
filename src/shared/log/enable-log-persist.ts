import { resolve } from "node:path";
import { envBool } from "../../node/env/env-parsers";
import { readEnv, requireEnv } from "../../node/env/require-env";
import { pollUntil } from "../../node/readiness";
import { createLogger } from "./create-logger";
import { LogPersist } from "./log-persist";
import {
    logPersistConfigFromEnv,
    logPersistEnabledFromEnv,
    logPersistProcessFromEnv,
    logPersistRegistryDirFromEnv,
    logPersistServiceFromEnv,
    resolveLogPersistConfig,
} from "./log-persist.config";
import type {
    EnableLogPersistOptions,
    EnsureLogPersistFromEnvOptions,
    LogPersistReadySnapshot,
    LogPersistStats,
    WaitForLogPersistReadyOptions,
} from "./log-persist.interface";
import { registerLogPersistOffer } from "./log-persist-hook";
import { LOG_PERSIST_TOPIC, persistLogger } from "./log-persist-logger";
import { defaultLogPersistRegistryPath, readLogPersistRegistry } from "./log-persist-registry";

export { logPersistEnabledFromEnv };

function resolveRegistryFilePath(explicit?: string): string {
    if (explicit != null && explicit.trim() !== "") {
        return resolve(explicit);
    }
    const dir = logPersistRegistryDirFromEnv();
    if (dir == null) {
        throw new Error(
            "[LogPersist] registry path required: set registryFilePath option or LOG_PERSIST_REGISTRY_DIR / RUNTIME_DATA_DIR",
        );
    }
    return defaultLogPersistRegistryPath(resolve(dir));
}

export async function enableLogPersist(options: EnableLogPersistOptions): Promise<void> {
    const registryFilePath = options.registryFilePath != null ? resolve(options.registryFilePath) : undefined;
    const resolvedRegistry = registryFilePath ?? resolveRegistryFilePath();

    const envConfig = logPersistConfigFromEnv();
    await LogPersist.getInstance().enable({
        ...options,
        registryFilePath: resolvedRegistry,
        config: resolveLogPersistConfig({
            fast: { ...envConfig.fast, ...options.config?.fast },
            medium: { ...envConfig.medium, ...options.config?.medium },
            slow: { ...envConfig.slow, ...options.config?.slow },
            postTimeoutMs: options.config?.postTimeoutMs ?? envConfig.postTimeoutMs,
            shutdownDrainTimeoutMs: options.config?.shutdownDrainTimeoutMs ?? envConfig.shutdownDrainTimeoutMs,
        }),
    });
}

export async function disableLogPersist(): Promise<void> {
    await LogPersist.getInstance().disable();
}

export function getLogPersistStats(): LogPersistStats {
    return LogPersist.getInstance().getStats();
}

/**
 * Enable log persistence when LOG_PERSIST_ENABLED=true.
 * `process` / `service` can be passed explicitly or via LOG_PERSIST_PROCESS / LOG_PERSIST_SERVICE.
 */
export async function ensureLogPersistFromEnv(options: EnsureLogPersistFromEnvOptions = {}): Promise<boolean> {
    if (!logPersistEnabledFromEnv()) {
        registerLogPersistOffer(null);
        return false;
    }

    const service = options.service ?? logPersistServiceFromEnv();
    const processName = options.process ?? logPersistProcessFromEnv();
    if (service == null || service === "") {
        throw new Error("[LogPersist] LOG_PERSIST_SERVICE is required when LOG_PERSIST_ENABLED=true");
    }
    if (processName == null || processName === "") {
        throw new Error(
            "[LogPersist] LOG_PERSIST_PROCESS is required when LOG_PERSIST_ENABLED=true (or pass process option)",
        );
    }

    const registryFilePath =
        options.registryFilePath != null ? resolve(options.registryFilePath) : resolveRegistryFilePath();

    await enableLogPersist({
        service,
        process: processName,
        registryFilePath,
        config: options.config,
    });

    const lifecycleLogger = createLogger({ module: "log-persist" });
    lifecycleLogger.info("log persist enabled from env", {
        topic: LOG_PERSIST_TOPIC,
        data: { service, process: processName, registryFilePath },
    });

    return true;
}

/**
 * Preload guard: when persistence is enabled, required env must be present before app code runs.
 */
export function validateLogPersistPreloadEnv(env: NodeJS.ProcessEnv = process.env): void {
    if (!envBool("LOG_PERSIST_ENABLED", false, env)) {
        return;
    }

    const missing: string[] = [];
    if (readEnv("LOG_PERSIST_SERVICE", env) == null) {
        missing.push("LOG_PERSIST_SERVICE");
    }
    const registryDir = logPersistRegistryDirFromEnv(env);
    if (registryDir == null) {
        missing.push("LOG_PERSIST_REGISTRY_DIR or RUNTIME_DATA_DIR");
    }

    if (missing.length > 0) {
        throw new Error(`[LogPersist] preload env incomplete: ${missing.join(", ")}`);
    }
}

function evaluateLogPersistReady(
    state: Awaited<ReturnType<typeof readLogPersistRegistry>>,
    expectedProcesses: string[],
    staleMs: number,
    now: number,
): LogPersistReadySnapshot {
    const missing: string[] = [];
    const stale: string[] = [];
    const registered: string[] = [];

    for (const processName of expectedProcesses) {
        const record = state.processes[processName];
        if (record == null) {
            missing.push(processName);
            continue;
        }

        const heartbeatAt = Date.parse(record.lastHeartbeatAt);
        if (!Number.isFinite(heartbeatAt) || now - heartbeatAt > staleMs) {
            stale.push(processName);
            continue;
        }

        registered.push(processName);
    }

    return {
        ok: missing.length === 0 && stale.length === 0,
        missing,
        stale,
        registered,
    };
}

/**
 * Wait until every expected process has registered in the shared registry with a fresh heartbeat.
 * Call from the service main process after spawning children.
 */
export async function waitForLogPersistReady(options: WaitForLogPersistReadyOptions): Promise<LogPersistReadySnapshot> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const staleMs = options.staleMs ?? 90_000;

    let last: LogPersistReadySnapshot = {
        ok: false,
        missing: [...options.expectedProcesses],
        stale: [],
        registered: [],
    };

    try {
        await pollUntil({
            intervalMs: pollIntervalMs,
            timeoutMs,
            until: async () => {
                const state = await readLogPersistRegistry(options.registryFilePath);
                if (state.service !== options.service) {
                    last = {
                        ok: false,
                        missing: options.expectedProcesses,
                        stale: [],
                        registered: [],
                    };
                    return false;
                }
                last = evaluateLogPersistReady(state, options.expectedProcesses, staleMs, Date.now());
                return last.ok;
            },
        });
    } catch {
        persistLogger.warn("waitForLogPersistReady timed out", {
            timeoutMs,
            expectedProcesses: options.expectedProcesses,
            ...last,
        });
    }

    return last;
}

export async function snapshotLogPersistReady(options: {
    registryFilePath: string;
    service: string;
    expectedProcesses: string[];
    staleMs?: number;
}): Promise<LogPersistReadySnapshot> {
    const state = await readLogPersistRegistry(options.registryFilePath);
    return evaluateLogPersistReady(state, options.expectedProcesses, options.staleMs ?? 90_000, Date.now());
}

export function resolveLogPersistRegistryPath(registryDir?: string): string {
    const dir = registryDir ?? logPersistRegistryDirFromEnv();
    if (dir == null) {
        requireEnv("LOG_PERSIST_REGISTRY_DIR");
    }
    return defaultLogPersistRegistryPath(resolve(dir ?? ""));
}
