import { EMPTY_REGISTRY_SLOT_RUNTIME_STATE } from "../../service/registry-lifecycle";
import type { JsonStatePatch } from "../fs/json-state-store";
import { createShardedJsonFileStateStore } from "../fs/sharded-json-state-store";
import type {
    DefaultExtraRuntimeSlices,
    GuardRuntimeSlice,
    ReadinessRuntimeSlice,
    SchedulerRuntimeSlice,
    ServiceRuntimeExtraSlicePatch,
    ServiceRuntimeNestedKeys,
    ServiceRuntimeState,
    WorkerRuntimeSlice,
} from "./service-runtime-state.types";

const EPOCH_ISO = new Date(0).toISOString();

export interface CreateServiceRuntimeStateStoreOptions<
    TExtraSlices extends Record<string, object> = DefaultExtraRuntimeSlices,
> {
    /**
     * Monolithic legacy path (`…/state.json`) or shard directory (`…/runtime-state/`).
     * Legacy files migrate automatically to `dirname/state.json → runtime-state/*.json`.
     */
    filePath: string;
    /** Default values for service-specific top-level nested slices. */
    extraDefaults?: TExtraSlices;
}

export interface FinishRunnerTickOptions<TExtraSlices extends Record<string, object> = DefaultExtraRuntimeSlices> {
    nowMs: number;
    lastFired: Record<string, string>;
    postedCount?: number;
    /** Patch extra slices in the same atomic write as the scheduler tick. */
    extra?: ServiceRuntimeExtraSlicePatch<TExtraSlices>;
}

export interface ServiceRuntimeStateStore<TExtraSlices extends Record<string, object> = DefaultExtraRuntimeSlices> {
    readRuntimeState(): Promise<ServiceRuntimeState<TExtraSlices>>;
    writeRuntimeState(
        patch: JsonStatePatch<ServiceRuntimeState<TExtraSlices>, ServiceRuntimeNestedKeys<TExtraSlices>>,
    ): Promise<ServiceRuntimeState<TExtraSlices>>;
    resetRuntimeStateForStartup(): Promise<ServiceRuntimeState<TExtraSlices>>;
    finishRunnerTick(options: FinishRunnerTickOptions<TExtraSlices>): Promise<void>;
}

function createDefaultServiceRuntimeState<TExtraSlices extends Record<string, object>>(options: {
    extraDefaults?: TExtraSlices;
}): ServiceRuntimeState<TExtraSlices> {
    const readiness: ReadinessRuntimeSlice = {
        status: "pending",
        checkedAt: null,
        message: null,
        checks: [],
    };
    const guard: GuardRuntimeSlice = {
        nodeId: null,
        lastCheckAt: null,
        lastDecision: null,
        lastSpawnAt: null,
        spawnCount: 0,
    };
    const scheduler: SchedulerRuntimeSlice = {
        lastTickAt: null,
        lastPostedCount: 0,
        lastFired: {},
    };
    const worker: WorkerRuntimeSlice = {
        pid: null,
        spawnedAt: null,
        ready: false,
        registeredTasks: [],
        readyAt: null,
    };

    return {
        updatedAt: EPOCH_ISO,
        readiness,
        guard,
        scheduler,
        worker,
        registry: { ...EMPTY_REGISTRY_SLOT_RUNTIME_STATE },
        ...(options.extraDefaults ?? ({} as TExtraSlices)),
    };
}

/** Sharded JSON runtime state (L3 blueprint) — one file per slice under `runtime-state/`. */
export function createServiceRuntimeStateStore<TExtraSlices extends Record<string, object> = DefaultExtraRuntimeSlices>(
    options: CreateServiceRuntimeStateStoreOptions<TExtraSlices>,
): ServiceRuntimeStateStore<TExtraSlices> {
    type State = ServiceRuntimeState<TExtraSlices>;
    type NK = ServiceRuntimeNestedKeys<TExtraSlices>;

    const defaultState = createDefaultServiceRuntimeState(options);
    const nestedKeys = [
        "readiness",
        "guard",
        "scheduler",
        "worker",
        "registry",
        ...(Object.keys(options.extraDefaults ?? {}) as (keyof TExtraSlices & string)[]),
    ] as NK[];

    const store = createShardedJsonFileStateStore<State, NK>({
        filePath: options.filePath,
        defaultState,
        nestedKeys,
        updatedAtKey: "updatedAt",
    });

    return {
        readRuntimeState: () => store.read(),
        writeRuntimeState: (patch) => store.write(patch),
        resetRuntimeStateForStartup: () => store.reset(),
        finishRunnerTick: async ({ nowMs, lastFired, postedCount, extra }) => {
            await store.write({
                scheduler: {
                    lastTickAt: new Date(nowMs).toISOString(),
                    lastFired,
                    ...(postedCount != null ? { lastPostedCount: postedCount } : {}),
                },
                ...extra,
            } as JsonStatePatch<State, NK>);
        },
    };
}
