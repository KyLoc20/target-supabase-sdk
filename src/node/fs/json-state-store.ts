import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonStatePatch<T extends object, NK extends keyof T> = Partial<Omit<T, NK>> & {
    [K in NK]?: T[K] extends object ? Partial<T[K]> : T[K];
};

export interface JsonFileStateStore<T extends object, NK extends keyof T = never> {
    read(): Promise<T>;
    write(patch: JsonStatePatch<T, NK>): Promise<T>;
    reset(): Promise<T>;
}

export interface CreateJsonFileStateStoreOptions<T extends object, NK extends keyof T = never> {
    filePath: string;
    defaultState: T;
    /** Top-level keys shallow-merged one level deep on read and write. */
    nestedKeys?: NK[];
    /** When set, assigned `new Date().toISOString()` on write and reset. */
    updatedAtKey?: keyof T;
}

function mergeWithNested<T extends object>(
    defaults: T,
    current: Partial<T> | undefined,
    patch: Partial<T>,
    nestedKeys: (keyof T)[],
): T {
    const merged = {
        ...defaults,
        ...current,
        ...patch,
    } as T;

    for (const key of nestedKeys) {
        const defaultNested = defaults[key];
        if (defaultNested != null && typeof defaultNested === "object") {
            (merged as Record<keyof T, unknown>)[key] = {
                ...defaultNested,
                ...(current?.[key] as object | undefined),
                ...(patch[key] as object | undefined),
            };
        }
    }

    return merged;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
}

/** JSON file-backed state with optional nested key merge and atomic writes. */
export function createJsonFileStateStore<T extends object, NK extends keyof T = never>(
    options: CreateJsonFileStateStoreOptions<T, NK>,
): JsonFileStateStore<T, NK> {
    const { filePath, defaultState, nestedKeys = [] as NK[], updatedAtKey } = options;

    function touchUpdatedAt(state: T): T {
        if (updatedAtKey == null) {
            return state;
        }
        return {
            ...state,
            [updatedAtKey]: new Date().toISOString(),
        };
    }

    return {
        async read(): Promise<T> {
            try {
                const raw = await readFile(filePath, "utf8");
                const parsed = JSON.parse(raw) as Partial<T>;
                return mergeWithNested(defaultState, parsed, {}, nestedKeys);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    return mergeWithNested(defaultState, {}, {}, nestedKeys);
                }
                throw error;
            }
        },

        async write(patch: JsonStatePatch<T, NK>): Promise<T> {
            const current = await this.read();
            const next = touchUpdatedAt(mergeWithNested(defaultState, current, patch as Partial<T>, nestedKeys));
            await atomicWriteJson(filePath, next);
            return next;
        },

        async reset(): Promise<T> {
            const next = touchUpdatedAt({ ...defaultState });
            await atomicWriteJson(filePath, next);
            return next;
        },
    };
}
