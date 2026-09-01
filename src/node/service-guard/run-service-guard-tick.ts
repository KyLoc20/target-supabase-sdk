import { scanTargetList } from "../../core.api";
import { patchServiceRuntime } from "../../service/registry.service";
import { CategoryNode, type Node } from "../node.interface";
import { evaluateBusyNodeLiveness } from "../node-liveness";
import { applyRegistrySlotGuardStep } from "./registry-slot-guard-step";
import type { ServiceGuardTickInput, ServiceGuardTickResult } from "./service-guard.interface";
import { getWorkerSpawnCooldownLastAt, markWorkerSpawned } from "./worker-spawn-cooldown";

/**
 * One guard-runner tick: registry slot check, TaskNode liveness, optional worker
 * respawn, Service runtime heartbeat rollup.
 */
export async function runServiceGuardTick(input: ServiceGuardTickInput): Promise<ServiceGuardTickResult> {
    const {
        serviceValue,
        serviceId,
        nodeId,
        loopTraceId,
        logger,
        logTopic = "guard",
        checkedAt,
        nowMs,
        taskNodeStaleMs,
        workerSpawnCooldownMs,
        maxNodes = 200,
        spawnWorker,
        getLastWorkerSpawnAt = getWorkerSpawnCooldownLastAt,
        markWorkerSpawned: markWorkerSpawnedAt = markWorkerSpawned,
    } = input;

    const continueTick = true;
    let registryPatch: ServiceGuardTickResult["registryPatch"];
    let decision = "idle";

    if (serviceId != null) {
        const guard = await applyRegistrySlotGuardStep({
            serviceValue,
            serviceId,
            checkedAt,
            logger,
            logTopic,
            traceId: loopTraceId,
        });
        registryPatch = guard.registryPatch;
        if (!guard.continueTick) {
            return { continueTick: false, decision: "slot_lost", nodes: [], registryPatch };
        }
        decision = "slot_ok";
    }

    const { data: nodes = [] } = await scanTargetList<Node>({
        category: CategoryNode.NODE,
        maxRows: maxNodes,
    });

    const liveness = evaluateBusyNodeLiveness(nodes, {
        staleMs: taskNodeStaleMs,
        now: nowMs,
        excludeNodeId: nodeId,
        onlyFreshCandidates: true,
    });

    const ageMs = liveness.freshest?.ageMs ?? Number.POSITIVE_INFINITY;

    if (liveness.healthy) {
        decision = "healthy";
    } else if (nowMs - getLastWorkerSpawnAt() < workerSpawnCooldownMs) {
        decision = "spawn_cooldown";
        logger.warn("TaskNode unavailable but spawn cooldown active", {
            topic: logTopic,
            data: {
                traceId: loopTraceId,
                ageMs,
                staleMs: taskNodeStaleMs,
                cooldownMs: workerSpawnCooldownMs,
            },
        });
    } else {
        decision = "spawn_worker";
        logger.warn("TaskNode stale — restarting worker", {
            topic: logTopic,
            data: {
                traceId: loopTraceId,
                peerWorkerCount: liveness.busyWorkerCount,
                freshPeerCount: liveness.freshWorkerCount,
                staleMs: taskNodeStaleMs,
            },
        });
        await spawnWorker("guard:restart-unhealthy-tasknode");
        markWorkerSpawnedAt(nowMs);
    }

    try {
        await patchServiceRuntime({
            serviceValue,
            serviceId: serviceId ?? undefined,
            nodes,
            lastHeartBeat: nowMs,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Failed to patch Service runtime rollup", {
            topic: logTopic,
            data: { traceId: loopTraceId, message },
        });
    }

    return { continueTick, decision, nodes, registryPatch };
}
