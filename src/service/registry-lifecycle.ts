import { deleteTarget } from "../core.api";
import { createLogger } from "../shared/log";
import {
    assertRegistrySlotAvailable,
    assertRegistrySlotOwner,
    registerServiceAtStartup,
    ServiceRegistryError,
    unregisterServiceAtShutdown,
} from "./registry.service";
import type { Service } from "./service.interface";

const LOG_TOPIC = "service-registry-lifecycle";

/** Shared registry slice for L3 runtime state files (`state.json`). */
export interface RegistrySlotRuntimeState {
    serviceId: string | null;
    serviceValue: string | null;
    slotOwned: boolean | null;
    lastSlotCheckAt: string | null;
    lastSlotCheckError: string | null;
}

export const EMPTY_REGISTRY_SLOT_RUNTIME_STATE: RegistrySlotRuntimeState = {
    serviceId: null,
    serviceValue: null,
    slotOwned: null,
    lastSlotCheckAt: null,
    lastSlotCheckError: null,
};

export function createClaimedRegistrySlotRuntimeState(service: Service): RegistrySlotRuntimeState {
    return {
        serviceId: service.id,
        serviceValue: service.value,
        slotOwned: true,
        lastSlotCheckAt: null,
        lastSlotCheckError: null,
    };
}

export interface ClaimRegistrySlotInput {
    serviceValue: string;
    createInstance: () => Promise<Service>;
    traceId?: string;
}

export interface ServiceRegistrySession {
    service: Service;
    /** Graceful shutdown — releases ACTIVE registry slot. */
    release: () => Promise<void>;
    /** Abandon orphan instance row when register never succeeded. */
    abandon: () => Promise<void>;
}

/**
 * Preflight → create Service instance → claim registry slot.
 * On register failure after `createInstance`, deletes the orphan Service row.
 */
export async function claimServiceRegistrySlot(input: ClaimRegistrySlotInput): Promise<ServiceRegistrySession> {
    const logger = createLogger({
        module: "claimServiceRegistrySlot",
        traceId: input.traceId,
        labels: { serviceValue: input.serviceValue },
    });

    await assertRegistrySlotAvailable(input.serviceValue);

    const service = await input.createInstance();
    let registered = false;

    try {
        await registerServiceAtStartup({ service, traceId: input.traceId });
        registered = true;
    } catch (error) {
        await deleteTarget({ id: service.id }).catch((deleteError: unknown) => {
            const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
            logger.warn("Failed to delete orphan Service row after register failure", {
                topic: LOG_TOPIC,
                data: { serviceId: service.id, message },
            });
        });
        throw error;
    }

    logger.info("registry slot claimed", {
        topic: LOG_TOPIC,
        data: { serviceValue: service.value, serviceId: service.id, registered },
    });

    return {
        service,
        release: async () => {
            await unregisterServiceAtShutdown({ service, traceId: input.traceId });
        },
        abandon: async () => {
            await deleteTarget({ id: service.id }).catch(() => undefined);
        },
    };
}

export interface RegistrySlotGuardResult {
    slotOwned: boolean | null;
    shouldShutdown: boolean;
    error?: string;
}

/**
 * Runtime guard step for service supervisor loops.
 * Transient read failures soft-fail; confirmed slot loss returns `shouldShutdown: true`.
 */
export async function runRegistrySlotGuardCheck(input: {
    serviceValue: string;
    serviceId: string;
}): Promise<RegistrySlotGuardResult> {
    try {
        await assertRegistrySlotOwner(input);
        return { slotOwned: true, shouldShutdown: false };
    } catch (error) {
        if (error instanceof ServiceRegistryError && error.code === "REGISTRY_SLOT_LOST") {
            return {
                slotOwned: false,
                shouldShutdown: true,
                error: error.message,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
            slotOwned: null,
            shouldShutdown: false,
            error: message,
        };
    }
}

export function registrySlotRuntimePatchFromGuardResult(
    result: RegistrySlotGuardResult,
    checkedAt: string,
): Pick<RegistrySlotRuntimeState, "slotOwned" | "lastSlotCheckAt" | "lastSlotCheckError"> {
    return {
        slotOwned: result.slotOwned,
        lastSlotCheckAt: checkedAt,
        lastSlotCheckError: result.error ?? null,
    };
}
