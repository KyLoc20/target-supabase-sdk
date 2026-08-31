import { ensureLogSpoolFromEnv, getLogSpoolStats, logSpoolEnabledFromEnv, shutdownLogSpoolFromEnv } from "./enable";
import type { LogSpoolWriterStats } from "./interface";

export interface LogSpoolCoordinatorOptions {
    /** Logical service value (e.g. `watch-service`). */
    serviceValue: string;
    /** Instance id after registry claim — passed to child spawn env. */
    serviceId: string;
}

/** Service-bound facade for file log spool writer lifecycle. */
export interface LogSpoolCoordinator {
    isEnabled(): boolean;
    getServiceId(): string;
    /** Enable spool writer in this process. */
    registerProcess(process?: string): Promise<boolean>;
    getWriterStats(): LogSpoolWriterStats | null;
    shutdownLogSpool(): Promise<void>;
}

export function createLogSpoolCoordinator(options: LogSpoolCoordinatorOptions): LogSpoolCoordinator {
    const { serviceValue, serviceId } = options;

    return {
        isEnabled() {
            return logSpoolEnabledFromEnv();
        },

        getServiceId() {
            return serviceId;
        },

        registerProcess(process?: string) {
            return ensureLogSpoolFromEnv({
                serviceValue,
                serviceId,
                processRole: process,
            });
        },

        getWriterStats() {
            if (!logSpoolEnabledFromEnv()) {
                return null;
            }
            return getLogSpoolStats();
        },

        async shutdownLogSpool() {
            if (!logSpoolEnabledFromEnv()) {
                return;
            }
            await shutdownLogSpoolFromEnv();
        },
    };
}
