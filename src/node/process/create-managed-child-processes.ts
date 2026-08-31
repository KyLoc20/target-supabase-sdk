import { createLogger } from "../../shared/log/core/create-logger";
import type { ManagedChildProcessesOptions } from "./managed-child-processes";
import { ManagedChildProcesses } from "./managed-child-processes";

export type CreateManagedChildProcessesOptions = Pick<
    ManagedChildProcessesOptions,
    "projectRoot" | "preloadModules" | "useTsx" | "graceMs"
> & {
    /** Defaults to `createLogger({ module: "launcher" })`. */
    logger?: ManagedChildProcessesOptions["logger"];
};

const DEFAULT_PRELOAD_MODULES = ["./scripts/preload.mjs"] as const;

/**
 * Standard L3 service child-process registry: node (not tsx), service preload, launcher logger.
 * Each service keeps a singleton in `src/startup/child-processes.ts`.
 */
export function createManagedChildProcesses(options: CreateManagedChildProcessesOptions): ManagedChildProcesses {
    return new ManagedChildProcesses({
        projectRoot: options.projectRoot,
        preloadModules: options.preloadModules ?? DEFAULT_PRELOAD_MODULES,
        useTsx: options.useTsx ?? false,
        graceMs: options.graceMs,
        logger: options.logger ?? createLogger({ module: "launcher" }),
    });
}
