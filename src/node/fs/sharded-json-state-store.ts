import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { createJsonFileStateStore, type JsonStatePatch } from "./json-state-store";
import { resolveRuntimeStatePaths, runtimeStateShardPath } from "./runtime-state-path";

export interface CreateShardedJsonFileStateStoreOptions<T extends object, NK extends keyof T> {
    /** Monolithic legacy path or shard directory root (see {@link resolveRuntimeStatePaths}). */
    filePath: string;
    defaultState: T;
    /** Top-level keys persisted as separate shard files. */
    nestedKeys: NK[];
    updatedAtKey?: keyof T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeSlice<T extends object>(defaults: T, key: keyof T, patchValue: unknown): T[keyof T] {
    const base = defaults[key];
    if (isPlainObject(base) && isPlainObject(patchValue)) {
        return { ...base, ...patchValue } as T[keyof T];
    }
    return patchValue as T[keyof T];
}

/**
 * JSON runtime state with **one file per top-level slice** (log-persist registry pattern).
 * Eliminates cross-slice lost updates when guard/scheduler/worker write concurrently.
 */
export function createShardedJsonFileStateStore<T extends object, NK extends keyof T>(
    options: CreateShardedJsonFileStateStoreOptions<T, NK>,
): {
    read(): Promise<T>;
    write(patch: JsonStatePatch<T, NK>): Promise<T>;
    reset(): Promise<T>;
} {
    const { defaultState, nestedKeys, updatedAtKey } = options;
    const { stateDir, legacyFilePath } = resolveRuntimeStatePaths(options.filePath);

    type ShardStore = ReturnType<typeof createJsonFileStateStore<object>>;
    const shardStores = new Map<string, ShardStore>();

    function shardStore(sliceKey: NK): ShardStore {
        const key = String(sliceKey);
        let store = shardStores.get(key);
        if (store == null) {
            store = createJsonFileStateStore({
                filePath: runtimeStateShardPath(stateDir, key),
                defaultState: defaultState[sliceKey] as object,
            });
            shardStores.set(key, store);
        }
        return store;
    }

    async function readUpdatedAtFromShardMtimes(): Promise<string> {
        let maxMtimeMs = 0;
        for (const sliceKey of nestedKeys) {
            try {
                const shardStat = await stat(runtimeStateShardPath(stateDir, String(sliceKey)));
                maxMtimeMs = Math.max(maxMtimeMs, shardStat.mtimeMs);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error;
                }
            }
        }
        if (maxMtimeMs <= 0) {
            return defaultState[updatedAtKey as keyof T] as string;
        }
        return new Date(maxMtimeMs).toISOString();
    }

    async function migrateLegacyMonolithicIfPresent(): Promise<void> {
        if (legacyFilePath == null) {
            return;
        }

        let raw: string;
        try {
            raw = await readFile(legacyFilePath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return;
            }
            throw error;
        }

        let parsed: Partial<T>;
        try {
            parsed = JSON.parse(raw) as Partial<T>;
        } catch {
            await unlink(legacyFilePath).catch(() => undefined);
            return;
        }

        await mkdir(stateDir, { recursive: true });
        for (const sliceKey of nestedKeys) {
            const slice = parsed[sliceKey];
            if (slice != null) {
                await shardStore(sliceKey).write(slice as object);
            }
        }

        await unlink(legacyFilePath).catch(() => undefined);
    }

    return {
        async read(): Promise<T> {
            await mkdir(stateDir, { recursive: true });
            await migrateLegacyMonolithicIfPresent();

            const merged = { ...defaultState } as T;
            for (const sliceKey of nestedKeys) {
                merged[sliceKey] = (await shardStore(sliceKey).read()) as T[NK];
            }
            if (updatedAtKey != null) {
                merged[updatedAtKey] = (await readUpdatedAtFromShardMtimes()) as T[keyof T];
            }
            return merged;
        },

        async write(patch: JsonStatePatch<T, NK>): Promise<T> {
            await mkdir(stateDir, { recursive: true });
            await migrateLegacyMonolithicIfPresent();

            for (const sliceKey of nestedKeys) {
                const patchSlice = patch[sliceKey];
                if (patchSlice == null) {
                    continue;
                }
                const current = await shardStore(sliceKey).read();
                const nextSlice = mergeSlice(defaultState, sliceKey, {
                    ...(current as object),
                    ...(patchSlice as object),
                });
                await shardStore(sliceKey).write(nextSlice as object);
            }

            return this.read();
        },

        async reset(): Promise<T> {
            await mkdir(stateDir, { recursive: true });

            for (const sliceKey of nestedKeys) {
                await shardStore(sliceKey).reset();
            }

            if (legacyFilePath != null) {
                await unlink(legacyFilePath).catch(() => undefined);
            }

            return this.read();
        },
    };
}
