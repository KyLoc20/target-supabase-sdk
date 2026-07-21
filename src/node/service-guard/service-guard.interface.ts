import type { Node } from "../../node/node.interface";
import type { RegistrySlotRuntimeState } from "../../service/registry-lifecycle";
import type { LoggerWithScope } from "../../shared/log";
import type { TriggerNodeOptions } from "../../trigger/trigger.interface";
import type { ReadinessCheck, ReadinessReport } from "../readiness/readiness.types";

/** Default TriggerManager runner key for {@link registerServiceGuardRunner}. */
export const SERVICE_GUARD_RUNNER_KEY = "service-guard";

export interface ServiceGuardTickInput {
    serviceValue: string;
    serviceId: string | null;
    nodeId: string;
    loopTraceId: string;
    logger: LoggerWithScope;
    logTopic?: string;
    checkedAt: string;
    nowMs: number;
    taskNodeStaleMs: number;
    workerSpawnCooldownMs: number;
    maxNodes?: number;
    spawnWorker: (reason: string) => Promise<void>;
    getLastWorkerSpawnAt?: () => number;
    markWorkerSpawned?: (at: number) => void;
}

export interface ServiceGuardTickResult {
    continueTick: boolean;
    decision: string;
    nodes: Node[];
    registryPatch?: Pick<RegistrySlotRuntimeState, "slotOwned" | "lastSlotCheckAt" | "lastSlotCheckError">;
}

export interface RegisterServiceGuardRunnerOptions {
    serviceValue: string;
    getServiceId: () => Promise<string | null>;
    logTopic?: string;
    runnerKey?: string;
    intervalMs: number;
    initialDelayMs?: number;
    taskNodeStaleMs: number;
    workerSpawnCooldownMs: number;
    maxNodes?: number;
    spawnWorker: (reason: string) => Promise<void>;
    onRegistryPatch: (
        patch: Pick<RegistrySlotRuntimeState, "slotOwned" | "lastSlotCheckAt" | "lastSlotCheckError">,
    ) => Promise<void>;
    onGuardPatch: (patch: { nodeId: string; lastCheckAt: string; lastDecision?: string }) => Promise<void>;
    onDecision?: (decision: string) => Promise<void>;
}

export interface ServiceGuardNodeOptions extends TriggerNodeOptions {
    serviceValue: string;
    logTopic?: string;
    readinessChecks: ReadinessCheck[];
    onReadinessReport: (report: ReadinessReport) => Promise<void>;
    guardRunner: Omit<
        RegisterServiceGuardRunnerOptions,
        "serviceValue" | "logTopic" | "runnerKey" | "intervalMs" | "initialDelayMs"
    > &
        Pick<RegisterServiceGuardRunnerOptions, "intervalMs" | "initialDelayMs">;
    spawnWorker: (reason: string) => Promise<void>;
    onWorkerSpawned?: () => void;
}
