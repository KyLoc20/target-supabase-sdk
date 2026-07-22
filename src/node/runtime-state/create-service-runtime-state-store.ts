import { EMPTY_REGISTRY_SLOT_RUNTIME_STATE } from "../../service/registry-lifecycle";
import { createJsonFileStateStore, type JsonFileStateStore, type JsonStatePatch } from "../fs/json-state-store";
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

/** JSON file-backed service runtime state (L3 blueprint) with typed core slices and extensions. */
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

    let store: JsonFileStateStore<State, NK> | undefined;

    function instance(): JsonFileStateStore<State, NK> {
        store ??= createJsonFileStateStore<State, NK>({
            filePath: options.filePath,
            defaultState,
            nestedKeys,
            updatedAtKey: "updatedAt",
        });
        return store;
    }

    return {
        readRuntimeState: () => instance().read(),
        writeRuntimeState: (patch) => instance().write(patch),
        resetRuntimeStateForStartup: () => instance().reset(),
        finishRunnerTick: async ({ nowMs, lastFired, postedCount, extra }) => {
            await instance().write({
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
