import { ServiceRegistryError } from "../../service/registry.service";
import { claimServiceRegistrySlot, type ServiceRegistrySession } from "../../service/registry-lifecycle";
import type { Service } from "../../service/service.interface";
import type { LoggerWithScope } from "../../shared/log";

export interface ClaimRegistrySlotOrExitInput {
    serviceValue: string;
    createInstance: () => Promise<Service>;
    logger: LoggerWithScope;
    logTopic: string;
}

/**
 * Claim a registry slot, or `process.exit(1)` when no EMPTY slot remains.
 * Other errors propagate.
 */
export async function claimRegistrySlotOrExit(input: ClaimRegistrySlotOrExitInput): Promise<ServiceRegistrySession> {
    try {
        return await claimServiceRegistrySlot({
            serviceValue: input.serviceValue,
            createInstance: input.createInstance,
        });
    } catch (error) {
        if (error instanceof ServiceRegistryError && error.code === "SERVICE_SLOTS_FULL") {
            input.logger.critical("No EMPTY registry slot — refusing to start", {
                topic: input.logTopic,
                data: { serviceValue: input.serviceValue, code: error.code },
            });
            process.exit(1);
        }
        throw error;
    }
}
