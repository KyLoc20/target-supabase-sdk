import type { TriggerRunnerContext } from "../../trigger/trigger.interface";
import { TriggerManager } from "../../trigger/trigger-manager";
import { runServiceGuardTick } from "./run-service-guard-tick";
import { type RegisterServiceGuardRunnerOptions, SERVICE_GUARD_RUNNER_KEY } from "./service-guard.interface";

async function runServiceGuardRunner(
    ctx: TriggerRunnerContext,
    options: RegisterServiceGuardRunnerOptionsWithClock,
): Promise<void> {
    const { loopTraceId, nodeId, logger } = ctx;
    const nowMs = options.now?.() ?? Date.now();
    const checkedAt = new Date(nowMs).toISOString();
    const serviceId = await options.getServiceId();

    const result = await runServiceGuardTick({
        serviceValue: options.serviceValue,
        serviceId,
        nodeId,
        loopTraceId,
        logger,
        logTopic: options.logTopic,
        checkedAt,
        nowMs,
        taskNodeStaleMs: options.taskNodeStaleMs,
        workerSpawnCooldownMs: options.workerSpawnCooldownMs,
        maxNodes: options.maxNodes,
        spawnWorker: options.spawnWorker,
    });

    if (result.registryPatch != null) {
        await options.onRegistryPatch(result.registryPatch);
    }

    if (!result.continueTick) {
        return;
    }

    await options.onGuardPatch({
        nodeId,
        lastCheckAt: checkedAt,
        lastDecision: result.decision,
    });

    if (options.onDecision != null) {
        await options.onDecision(result.decision);
    }
}

export interface RegisterServiceGuardRunnerOptionsWithClock extends RegisterServiceGuardRunnerOptions {
    /** Test hook — defaults to Date.now(). */
    now?: () => number;
}

/** Register the standard L3 guard runner (registry slot + TaskNode + Service runtime). */
export function registerServiceGuardRunner(options: RegisterServiceGuardRunnerOptionsWithClock): void {
    TriggerManager.registerRunner({
        key: options.runnerKey ?? SERVICE_GUARD_RUNNER_KEY,
        intervalMs: options.intervalMs,
        initialDelayMs: options.initialDelayMs,
        fn: (ctx) => runServiceGuardRunner(ctx, options),
    });
}
