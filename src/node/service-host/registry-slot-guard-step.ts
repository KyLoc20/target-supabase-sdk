import { registrySlotRuntimePatchFromGuardResult, runRegistrySlotGuardCheck } from "../../service/registry-lifecycle";
import type { LoggerWithScope } from "../../shared/log";

export interface ApplyRegistrySlotGuardInput {
    serviceValue: string;
    serviceId: string;
    checkedAt: string;
    logger: Pick<LoggerWithScope, "critical" | "warn">;
    logTopic?: string;
    traceId?: string;
}

export interface ApplyRegistrySlotGuardResult {
    /** When false, caller should abort the supervisor tick (slot lost shutdown initiated). */
    continueTick: boolean;
    registryPatch: ReturnType<typeof registrySlotRuntimePatchFromGuardResult>;
}

/**
 * Run registry slot ownership check and optionally SIGTERM the parent main process.
 * Used by guard / supervisor TriggerNode runners across L3 services.
 */
export async function applyRegistrySlotGuardStep(
    input: ApplyRegistrySlotGuardInput,
): Promise<ApplyRegistrySlotGuardResult> {
    const result = await runRegistrySlotGuardCheck({
        serviceValue: input.serviceValue,
        serviceId: input.serviceId,
    });
    const registryPatch = registrySlotRuntimePatchFromGuardResult(result, input.checkedAt);

    if (result.shouldShutdown) {
        input.logger.critical("Registry slot lost — shutting down service", {
            topic: input.logTopic ?? "guard",
            data: {
                traceId: input.traceId,
                serviceId: input.serviceId,
                serviceValue: input.serviceValue,
            },
        });
        process.kill(process.ppid, "SIGTERM");
        return { continueTick: false, registryPatch };
    }

    if (result.error != null) {
        input.logger.warn("Registry slot check failed (transient) — skipping enforcement this tick", {
            topic: input.logTopic ?? "guard",
            data: {
                traceId: input.traceId,
                serviceId: input.serviceId,
                message: result.error,
            },
        });
    }

    return { continueTick: true, registryPatch };
}
