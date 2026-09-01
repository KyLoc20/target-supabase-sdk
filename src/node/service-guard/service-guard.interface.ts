import type { RegistrySlotRuntimeState } from "../../service/registry-lifecycle";
import type { LoggerWithScope } from "../../shared/log";
import type { Node } from "../node.interface";
import type { ReadinessCheck, ReadinessReport } from "../readiness/readiness.types";
import type { GuardRuntimeSlice } from "../runtime-state/service-runtime-state.types";

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
    onGuardPatch: (patch: Partial<GuardRuntimeSlice>) => Promise<void>;
    onDecision?: (decision: string) => Promise<void>;
}

export interface ServiceGuardNodeOptions {
    serviceValue: string;
    logTopic?: string;
    readinessChecks: ReadinessCheck[];
    onReadinessReport: (report: ReadinessReport) => Promise<void>;
    guardRunner: Omit<RegisterServiceGuardRunnerOptions, "serviceValue" | "logTopic" | "runnerKey" | "spawnWorker">;
    /**
     * Idempotent spawn of all business nodes (scheduler + worker, etc.).
     * Used at bootstrap, silent recovery, and healthy-mode TaskNode respawn.
     */
    spawnBusinessNodes: (reason: string) => Promise<void>;
    /** Stop business nodes only (never the guard process). */
    stopBusinessNodes: () => Promise<void>;
    /** Local runtime gate: all business nodes registered and ready. */
    isBusinessReady: () => Promise<boolean>;
    /** Timeout for {@link isBusinessReady} during bootstrap and recovery. Default 180s. */
    businessReadyTimeoutMs?: number;
    /** Extra hook after the initial business spawn (cooldown is recorded automatically). */
    onWorkerSpawned?: () => void;
    beforeProcessExit?: () => void | Promise<void>;
}

/** True when the guard slice is serving traffic (`mode` omitted = legacy healthy). */
export function isGuardAvailable(guard: Pick<GuardRuntimeSlice, "mode">): boolean {
    return guard.mode == null || guard.mode === "healthy";
}

/**
 * Seconds for `Retry-After` when the guard is not serving traffic.
 * `null` when {@link isGuardAvailable} is true.
 */
export function guardRetryAfterSec(guard: Pick<GuardRuntimeSlice, "mode" | "silentBackoffMs">): number | null {
    if (isGuardAvailable(guard)) {
        return null;
    }
    const backoffMs = guard.silentBackoffMs > 0 ? guard.silentBackoffMs : 15_000;
    return Math.max(1, Math.ceil(backoffMs / 1000));
}
