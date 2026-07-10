import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createJsonFileStateStore } from "../../node/fs/json-state-store";
import type { LogPersistProcessRecord, LogPersistRegistryState } from "./log-persist.interface";
import { persistLogger } from "./log-persist-logger";

const DEFAULT_REGISTRY: LogPersistRegistryState = {
    updatedAt: new Date(0).toISOString(),
    service: "",
    processes: {},
};

/** Per-process shard — each process owns one file; no cross-process RMW. */
interface LogPersistProcessShard extends LogPersistProcessRecord {
    service: string;
    updatedAt: string;
}

const DEFAULT_SHARD: LogPersistProcessShard = {
    service: "",
    updatedAt: new Date(0).toISOString(),
    pid: 0,
    enabledAt: new Date(0).toISOString(),
    lastHeartbeatAt: new Date(0).toISOString(),
};

const legacyStores = new Map<
    string,
    ReturnType<typeof createJsonFileStateStore<LogPersistRegistryState, "processes">>
>();

const shardStores = new Map<string, ReturnType<typeof createJsonFileStateStore<LogPersistProcessShard>>>();

function isLegacyRegistryFile(registryPath: string): boolean {
    return registryPath.endsWith(".json");
}

function legacyStoreFor(filePath: string) {
    let store = legacyStores.get(filePath);
    if (store == null) {
        store = createJsonFileStateStore<LogPersistRegistryState, "processes">({
            filePath,
            defaultState: DEFAULT_REGISTRY,
            nestedKeys: ["processes"],
            updatedAtKey: "updatedAt",
        });
        legacyStores.set(filePath, store);
    }
    return store;
}

function shardStoreFor(shardFilePath: string) {
    let store = shardStores.get(shardFilePath);
    if (store == null) {
        store = createJsonFileStateStore<LogPersistProcessShard>({
            filePath: shardFilePath,
            defaultState: DEFAULT_SHARD,
            updatedAtKey: "updatedAt",
        });
        shardStores.set(shardFilePath, store);
    }
    return store;
}

function shardFilePath(registryDir: string, process: string): string {
    return join(registryDir, `${process}.json`);
}

/** Registry root directory — one shard file per process under this path. */
export function defaultLogPersistRegistryPath(registryDir: string): string {
    return join(registryDir, "log-persist-registry");
}

async function readShardedLogPersistRegistry(registryDir: string): Promise<LogPersistRegistryState> {
    await mkdir(registryDir, { recursive: true });

    let entries: string[];
    try {
        entries = await readdir(registryDir);
    } catch {
        return { ...DEFAULT_REGISTRY };
    }

    const processes: Record<string, LogPersistProcessRecord> = {};
    let service = "";
    let updatedAt = new Date(0).toISOString();

    for (const name of entries) {
        if (!name.endsWith(".json")) {
            continue;
        }

        const processName = name.slice(0, -".json".length);
        if (processName === "" || processName.startsWith("_")) {
            continue;
        }

        try {
            const raw = await readFile(join(registryDir, name), "utf8");
            const shard = JSON.parse(raw) as Partial<LogPersistProcessShard>;
            if (shard.service != null && shard.service !== "") {
                service = shard.service;
            }
            if (shard.updatedAt != null && shard.updatedAt > updatedAt) {
                updatedAt = shard.updatedAt;
            }
            processes[processName] = {
                pid: shard.pid ?? 0,
                enabledAt: shard.enabledAt ?? new Date(0).toISOString(),
                lastHeartbeatAt: shard.lastHeartbeatAt ?? new Date(0).toISOString(),
            };
        } catch {
            persistLogger.warn("registry shard read skipped — corrupt or missing", {
                registryDir,
                shard: name,
            });
        }
    }

    return { updatedAt, service, processes };
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

    if (isLegacyRegistryFile(input.registryFilePath)) {
        await legacyStoreFor(input.registryFilePath).write({
            service: input.service,
            processes: {
                [input.process]: record,
            },
        });
    } else {
        await shardStoreFor(shardFilePath(input.registryFilePath, input.process)).write({
            service: input.service,
            pid: record.pid,
            enabledAt: record.enabledAt,
            lastHeartbeatAt: record.lastHeartbeatAt,
        });
    }

    persistLogger.info("registry process registered", {
        registryFilePath: input.registryFilePath,
        service: input.service,
        process: input.process,
        pid: record.pid,
    });
}

export async function heartbeatLogPersistProcess(input: { registryFilePath: string; process: string }): Promise<void> {
    if (isLegacyRegistryFile(input.registryFilePath)) {
        const current = await legacyStoreFor(input.registryFilePath).read();
        const existing = current.processes[input.process];
        if (existing == null) {
            persistLogger.warn("registry heartbeat skipped — process not registered", {
                registryFilePath: input.registryFilePath,
                process: input.process,
            });
            return;
        }

        await legacyStoreFor(input.registryFilePath).write({
            processes: {
                [input.process]: {
                    ...existing,
                    lastHeartbeatAt: new Date().toISOString(),
                },
            },
        });
        return;
    }

    const store = shardStoreFor(shardFilePath(input.registryFilePath, input.process));
    const current = await store.read();
    if (current.pid === 0) {
        persistLogger.warn("registry heartbeat skipped — process not registered", {
            registryFilePath: input.registryFilePath,
            process: input.process,
        });
        return;
    }

    await store.write({
        lastHeartbeatAt: new Date().toISOString(),
    });
}

export async function unregisterLogPersistProcess(input: { registryFilePath: string; process: string }): Promise<void> {
    if (isLegacyRegistryFile(input.registryFilePath)) {
        const current = await legacyStoreFor(input.registryFilePath).read();
        const existing = current.processes[input.process];
        if (existing == null) {
            persistLogger.warn("registry unregister skipped — process not found", {
                registryFilePath: input.registryFilePath,
                process: input.process,
            });
            return;
        }

        await legacyStoreFor(input.registryFilePath).write({
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
        return;
    }

    const store = shardStoreFor(shardFilePath(input.registryFilePath, input.process));
    const current = await store.read();
    if (current.pid === 0) {
        persistLogger.warn("registry unregister skipped — process not found", {
            registryFilePath: input.registryFilePath,
            process: input.process,
        });
        return;
    }

    await store.write({
        pid: 0,
        lastHeartbeatAt: new Date(0).toISOString(),
    });

    persistLogger.info("registry process unregistered", {
        registryFilePath: input.registryFilePath,
        process: input.process,
    });
}

export async function readLogPersistRegistry(registryFilePath: string): Promise<LogPersistRegistryState> {
    if (isLegacyRegistryFile(registryFilePath)) {
        return legacyStoreFor(registryFilePath).read();
    }
    return readShardedLogPersistRegistry(registryFilePath);
}
