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
    service: string;
    registryFilePath: string;
    expectedProcesses: readonly string[];
    /** Passed to `waitForLogPersistReady` (default 60_000 ms). */
    readyTimeoutMs?: number;
}

export interface LogPersistCoordinator {
    enabled(): boolean;
    registryPath(): string;
    ensure(process?: string): Promise<boolean>;
    waitUntilReady(): Promise<LogPersistReadySnapshot>;
    snapshotReady(): Promise<LogPersistReadySnapshot | null>;
    collectStats(): LogPersistStats | null;
    shutdown(): Promise<void>;
}

/**
 * Bind service-specific log-persist registry settings (process list, paths, timeouts).
 * Each L3 service keeps one instance in `src/startup/log-persist.ts`.
 */
export function createLogPersistCoordinator(options: LogPersistCoordinatorOptions): LogPersistCoordinator {
    const { service, registryFilePath, expectedProcesses, readyTimeoutMs } = options;

    return {
        enabled() {
            return logPersistEnabledFromEnv();
        },

        registryPath() {
            return registryFilePath;
        },

        ensure(process?: string) {
            return ensureLogPersistFromEnv({
                process,
                service,
                registryFilePath,
            });
        },

        waitUntilReady() {
            return waitForLogPersistReady({
                registryFilePath,
                service,
                expectedProcesses: [...expectedProcesses],
                timeoutMs: readyTimeoutMs,
            });
        },

        async snapshotReady() {
            if (!logPersistEnabledFromEnv()) {
                return null;
            }
            return snapshotLogPersistReady({
                registryFilePath,
                service,
                expectedProcesses: [...expectedProcesses],
            });
        },

        collectStats() {
            if (!logPersistEnabledFromEnv()) {
                return null;
            }
            return getLogPersistStats();
        },

        async shutdown() {
            if (!logPersistEnabledFromEnv()) {
                return;
            }
            await disableLogPersist();
        },
    };
}
