import type { ChildProcess } from "node:child_process";
import type { ManagedChildProcesses } from "../process/managed-child-processes";
import type {
    GuardRuntimeSlice,
    SchedulerRuntimeSlice,
    WorkerRuntimeSlice,
} from "../runtime-state/service-runtime-state.types";

const WORKER_SCRIPT = "./dist/processes/worker.js";
const GUARD_SCRIPT = "./dist/processes/guard.js";
const SCHEDULER_SCRIPT = "./dist/processes/scheduler.js";

export interface L3ChildLauncherRuntimeStore {
    readRuntimeState(): Promise<{
        worker: WorkerRuntimeSlice;
        scheduler: SchedulerRuntimeSlice;
        guard: GuardRuntimeSlice;
    }>;
    writeRuntimeState(patch: {
        worker?: Partial<WorkerRuntimeSlice>;
        scheduler?: Partial<SchedulerRuntimeSlice>;
        guard?: Partial<GuardRuntimeSlice>;
    }): Promise<unknown>;
}

export interface CreateL3ChildLauncherOptions {
    childProcesses: ManagedChildProcesses;
    readRuntimeState: L3ChildLauncherRuntimeStore["readRuntimeState"];
    writeRuntimeState: L3ChildLauncherRuntimeStore["writeRuntimeState"];
    /** Merged onto the child env. Default: `{ LOG_PERSIST_PROCESS: label }`. */
    spawnEnv?: (label: string) => Record<string, string>;
}

export interface L3ChildLauncher {
    spawnGuard: () => ChildProcess;
    spawnTaskWorker: (reason: string) => Promise<ChildProcess>;
    spawnScheduler: (reason: string) => Promise<ChildProcess>;
    spawnBusinessNodes: (reason: string) => Promise<void>;
    stopBusinessNodes: () => Promise<void>;
    isBusinessReady: () => Promise<boolean>;
    stopChildProcesses: () => Promise<void>;
}

function defaultSpawnEnv(label: string): Record<string, string> {
    return { LOG_PERSIST_PROCESS: label };
}

/**
 * Guard-owned scheduler + worker spawn/stop, plus main-owned Guard spawn.
 * `stopBusinessNodes` must run in the Guard process (that instance's children only).
 * `stopChildProcesses` is for main shutdown (`extraPids` for Guard-spawned PIDs).
 */
export function createL3ChildLauncher(options: CreateL3ChildLauncherOptions): L3ChildLauncher {
    const { childProcesses, readRuntimeState, writeRuntimeState } = options;
    const spawnEnv = options.spawnEnv ?? defaultSpawnEnv;

    function nowIso(): string {
        return new Date().toISOString();
    }

    async function spawnTaskWorker(reason: string): Promise<ChildProcess> {
        const { child, created } = childProcesses.spawn("worker", WORKER_SCRIPT, {
            env: spawnEnv("worker"),
        });
        if (!created) {
            return child;
        }

        const current = await readRuntimeState();
        await writeRuntimeState({
            worker: {
                pid: child.pid ?? null,
                spawnedAt: nowIso(),
                ready: false,
                registeredTasks: [],
                readyAt: null,
            },
            guard: {
                lastSpawnAt: nowIso(),
                lastDecision: reason,
                spawnCount: current.guard.spawnCount + 1,
            },
        });

        return child;
    }

    function spawnGuard(): ChildProcess {
        return childProcesses.spawn("guard", GUARD_SCRIPT, { env: spawnEnv("guard") }).child;
    }

    async function spawnScheduler(reason: string): Promise<ChildProcess> {
        const { child, created } = childProcesses.spawn("scheduler", SCHEDULER_SCRIPT, {
            env: spawnEnv("scheduler"),
        });
        if (!created) {
            return child;
        }

        await writeRuntimeState({
            scheduler: {
                pid: child.pid ?? null,
                spawnedAt: nowIso(),
                ready: false,
                readyAt: null,
            },
            guard: {
                lastDecision: reason,
            },
        });

        return child;
    }

    async function spawnBusinessNodes(reason: string): Promise<void> {
        await spawnScheduler(reason);
        await spawnTaskWorker(reason);
    }

    async function stopBusinessNodes(): Promise<void> {
        await childProcesses.stopAll();
        await writeRuntimeState({
            worker: {
                pid: null,
                ready: false,
                readyAt: null,
                registeredTasks: [],
            },
            scheduler: {
                pid: null,
                ready: false,
                readyAt: null,
            },
        });
    }

    async function isBusinessReady(): Promise<boolean> {
        const state = await readRuntimeState();
        return state.worker.ready && state.scheduler.ready;
    }

    async function stopChildProcesses(): Promise<void> {
        const state = await readRuntimeState();
        const extraPids = [state.worker.pid, state.scheduler.pid].filter((pid): pid is number => pid != null);
        await childProcesses.stopAll({ extraPids });
    }

    return {
        spawnGuard,
        spawnTaskWorker,
        spawnScheduler,
        spawnBusinessNodes,
        stopBusinessNodes,
        isBusinessReady,
        stopChildProcesses,
    };
}
