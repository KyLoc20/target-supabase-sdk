import { join } from "node:path";
import { createJsonFileStateStore } from "../../node/fs/json-state-store";
import type { LogPersistProcessRecord, LogPersistRegistryState } from "./log-persist.interface";
import { persistLogger } from "./log-persist-logger";

const DEFAULT_REGISTRY: LogPersistRegistryState = {
    updatedAt: new Date(0).toISOString(),
    service: "",
    processes: {},
};

const stores = new Map<string, ReturnType<typeof createJsonFileStateStore<LogPersistRegistryState, "processes">>>();

function storeFor(filePath: string) {
    let store = stores.get(filePath);
    if (store == null) {
        store = createJsonFileStateStore<LogPersistRegistryState, "processes">({
            filePath,
            defaultState: DEFAULT_REGISTRY,
            nestedKeys: ["processes"],
            updatedAtKey: "updatedAt",
        });
        stores.set(filePath, store);
    }
    return store;
}

export function defaultLogPersistRegistryPath(registryDir: string): string {
    return join(registryDir, "log-persist-registry.json");
}

export async function registerLogPersistProcess(input: {
    registryFilePath: string;
    service: string;
    process: string;
}): Promise<void> {
    const now = new Date().toISOString();
    const record: LogPersistProcessRecord = {
        pid: process.pid,
        enabledAt: now,
        lastHeartbeatAt: now,
    };

    await storeFor(input.registryFilePath).write({
        service: input.service,
        processes: {
            [input.process]: record,
        },
    });

    persistLogger.info("registry process registered", {
        registryFilePath: input.registryFilePath,
        service: input.service,
        process: input.process,
        pid: record.pid,
    });
}

export async function heartbeatLogPersistProcess(input: { registryFilePath: string; process: string }): Promise<void> {
    const current = await storeFor(input.registryFilePath).read();
    const existing = current.processes[input.process];
    if (existing == null) {
        persistLogger.warn("registry heartbeat skipped — process not registered", {
            registryFilePath: input.registryFilePath,
            process: input.process,
        });
        return;
    }

    await storeFor(input.registryFilePath).write({
        processes: {
            [input.process]: {
                ...existing,
                lastHeartbeatAt: new Date().toISOString(),
            },
        },
    });
}

export async function unregisterLogPersistProcess(input: { registryFilePath: string; process: string }): Promise<void> {
    const current = await storeFor(input.registryFilePath).read();
    const existing = current.processes[input.process];
    if (existing == null) {
        persistLogger.warn("registry unregister skipped — process not found", {
            registryFilePath: input.registryFilePath,
            process: input.process,
        });
        return;
    }

    await storeFor(input.registryFilePath).write({
        processes: {
            [input.process]: {
                ...existing,
                pid: 0,
                lastHeartbeatAt: new Date(0).toISOString(),
            },
        },
    });

    persistLogger.info("registry process unregistered", {
        registryFilePath: input.registryFilePath,
        process: input.process,
    });
}

export async function readLogPersistRegistry(registryFilePath: string): Promise<LogPersistRegistryState> {
    return storeFor(registryFilePath).read();
}
