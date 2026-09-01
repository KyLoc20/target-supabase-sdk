import type { RegistrySlotRuntimeState } from "../../service/registry-lifecycle";

export type ReadinessStatus = "pending" | "passed" | "failed";

export interface ReadinessRuntimeSlice {
    status: ReadinessStatus;
    checkedAt: string | null;
    message: string | null;
    checks: { name: string; ok: boolean; detail?: string }[];
}

export interface GuardRuntimeSlice {
    nodeId: string | null;
    lastCheckAt: string | null;
    lastDecision: string | null;
    lastSpawnAt: string | null;
    spawnCount: number;
    /** `healthy` when omitted (legacy shards). Silent: heartbeat-only wait. Recovering: respawn business nodes. */
    mode: "healthy" | "silent" | "recovering";
    silentEnteredAt: string | null;
    silentLastHeartbeatAt: string | null;
    silentBackoffMs: number;
    silentConsecutiveFailures: number;
    silentRecoveryAttempt: number;
    silentEvents: { at: string; type: string; detail?: string }[];
}

export interface SchedulerRuntimeSlice {
    lastTickAt: string | null;
    lastPostedCount: number;
    lastFired: Record<string, string>;
    pid: number | null;
    spawnedAt: string | null;
    ready: boolean;
    readyAt: string | null;
}

export interface WorkerRuntimeSlice {
    pid: number | null;
    spawnedAt: string | null;
    ready: boolean;
    registeredTasks: string[];
    readyAt: string | null;
}

/**
 * Default when an L3 service has no service-specific runtime state slices.
 * Use an empty object type (not `Record<string, never>`) so intersecting with core
 * slices does not add a string index signature that collapses property types to `never`.
 */
export type DefaultExtraRuntimeSlices = Record<never, never>;

/**
 * Cross-process service runtime state persisted to `state.json`.
 * L3 blueprint: readiness + guard + scheduler + worker + registry.
 * Extend via extra top-level slices only.
 */
export type ServiceRuntimeState<TExtraSlices extends Record<string, object> = DefaultExtraRuntimeSlices> = {
    updatedAt: string;
    readiness: ReadinessRuntimeSlice;
    guard: GuardRuntimeSlice;
    scheduler: SchedulerRuntimeSlice;
    worker: WorkerRuntimeSlice;
    registry: RegistrySlotRuntimeState;
} & TExtraSlices;

export type ServiceRuntimeCoreNestedKey = "readiness" | "guard" | "scheduler" | "worker" | "registry";

export type ServiceRuntimeNestedKeys<TExtraSlices extends Record<string, object>> =
    | ServiceRuntimeCoreNestedKey
    | (keyof TExtraSlices & string);

/** Patch shape for extra top-level slices (one level deep). */
export type ServiceRuntimeExtraSlicePatch<TExtraSlices extends Record<string, object>> = {
    [K in keyof TExtraSlices]?: TExtraSlices[K] extends object ? Partial<TExtraSlices[K]> : TExtraSlices[K];
};
