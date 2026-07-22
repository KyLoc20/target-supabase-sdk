import {
    disableLogPersist,
    ensureLogPersistFromEnv,
    getLogPersistStats,
    logPersistEnabledFromEnv,
    snapshotLogPersistReady,
    waitForLogPersistReady,
} from "./enable-log-persist";
import type { LogPersistReadySnapshot, LogPersistStats } from "./log-persist.interface";

export interface LogPersistCoordinatorOptions {
    /** Service identity written into each registry shard (e.g. `log-service`). */
    service: string;
    /** Directory holding one JSON shard per process (`main.json`, `guard.json`, …). */
    registryFilePath: string;
    /** Process labels main waits for before accepting traffic (must match `LOG_PERSIST_PROCESS` per child). */
    expectedProcesses: readonly string[];
    /** Max wait for {@link LogPersistCoordinator.waitForAllProcessesReady} (default 60_000 ms). */
    readyTimeoutMs?: number;
}

/** Service-bound facade over env-driven log-persist registration and readiness gates. */
export interface LogPersistCoordinator {
    /** Whether `LOG_PERSIST_ENABLED` is active in this process. */
    isEnabled(): boolean;

    /** Absolute path to the multi-process registry directory configured at construction. */
    getRegistryFilePath(): string;

    /**
     * Enable log-persist for this process and write/update its registry shard.
     * @param process Optional label; defaults to `LOG_PERSIST_PROCESS` env.
     */
    registerProcess(process?: string): Promise<boolean>;

    /** Block until every {@link LogPersistCoordinatorOptions.expectedProcesses} entry is registered and fresh. */
    waitForAllProcessesReady(): Promise<LogPersistReadySnapshot>;

    /** Immediate readiness snapshot without blocking; `null` when log-persist is disabled. */
    snapshotProcessesReady(): Promise<LogPersistReadySnapshot | null>;

    /** Flush-queue stats for observability; `null` when log-persist is disabled. */
    getPersistStats(): LogPersistStats | null;

    /** Flush pending logs and tear down log-persist (call from process shutdown hooks). */
    shutdownLogPersist(): Promise<void>;
}

/**
 * Bind service-specific log-persist registry settings (process list, paths, timeouts).
 * Each L3 service exports one instance from `src/startup/log-persist.ts`.
 */
export function createLogPersistCoordinator(options: LogPersistCoordinatorOptions): LogPersistCoordinator {
    const { service, registryFilePath, expectedProcesses, readyTimeoutMs } = options;

    return {
        isEnabled() {
            return logPersistEnabledFromEnv();
        },

        getRegistryFilePath() {
            return registryFilePath;
        },

        registerProcess(process?: string) {
            return ensureLogPersistFromEnv({
                process,
                service,
                registryFilePath,
            });
        },

        waitForAllProcessesReady() {
            return waitForLogPersistReady({
                registryFilePath,
                service,
                expectedProcesses: [...expectedProcesses],
                timeoutMs: readyTimeoutMs,
            });
        },

        async snapshotProcessesReady() {
            if (!logPersistEnabledFromEnv()) {
                return null;
            }
            return snapshotLogPersistReady({
                registryFilePath,
                service,
                expectedProcesses: [...expectedProcesses],
            });
        },

        getPersistStats() {
            if (!logPersistEnabledFromEnv()) {
                return null;
            }
            return getLogPersistStats();
        },

        async shutdownLogPersist() {
            if (!logPersistEnabledFromEnv()) {
                return;
            }
            await disableLogPersist();
        },
    };
}
