import { dirname, join } from "node:path";

const RUNTIME_STATE_SHARD_DIR = "runtime-state";

export interface ResolvedRuntimeStatePaths {
    /** Directory holding one JSON file per top-level slice. */
    stateDir: string;
    /** Legacy monolithic `state.json` — migrated on read/reset when present. */
    legacyFilePath: string | null;
}

/**
 * Resolve sharded runtime state layout from {@link CreateServiceRuntimeStateStoreOptions.filePath}.
 *
 * | `filePath`              | Shard dir                         | Legacy        |
 * |-------------------------|-----------------------------------|---------------|
 * | `.../state.json`        | `.../runtime-state/`              | `state.json`  |
 * | `.../runtime-state/`    | same directory                    | none          |
 */
export function resolveRuntimeStatePaths(filePath: string): ResolvedRuntimeStatePaths {
    if (filePath.endsWith(".json")) {
        return {
            stateDir: join(dirname(filePath), RUNTIME_STATE_SHARD_DIR),
            legacyFilePath: filePath,
        };
    }
    return {
        stateDir: filePath,
        legacyFilePath: null,
    };
}

export function runtimeStateShardPath(stateDir: string, sliceKey: string): string {
    return join(stateDir, `${sliceKey}.json`);
}
