import { type ChildProcess, type StdioOptions, spawn } from "node:child_process";

export interface BuildNodeImportArgsInput {
    /** Relative `--import` paths (e.g. `./scripts/preload-env.mjs`). */
    preloadModules?: readonly string[];
    /** When true (default), inserts `--import tsx` before the entry script. */
    useTsx?: boolean;
    /** Entry script relative to `projectRoot` when spawning. */
    entryScript: string;
}

/**
 * Build argv for `node --import … --import tsx <entry>`.
 * Use **relative** preload paths with `cwd: projectRoot` — Node 24 on Windows rejects
 * absolute paths like `D:\…` for `--import` (ESM URL scheme error).
 */
export function buildNodeImportArgs(input: BuildNodeImportArgsInput): string[] {
    const preloadModules = input.preloadModules ?? [];
    const useTsx = input.useTsx ?? true;
    const args: string[] = [];

    for (const modulePath of preloadModules) {
        args.push("--import", modulePath);
    }
    if (useTsx) {
        args.push("--import", "tsx");
    }
    args.push(input.entryScript);
    return args;
}

export interface SpawnTsxChildOptions {
    projectRoot: string;
    entryScript: string;
    preloadModules?: readonly string[];
    useTsx?: boolean;
    env?: NodeJS.ProcessEnv;
    stdio?: StdioOptions;
}

/** Spawn `node` with preload chain + tsx + TypeScript entry (relative to projectRoot). */
export function spawnTsxChild(options: SpawnTsxChildOptions): ChildProcess {
    return spawn(
        process.execPath,
        buildNodeImportArgs({
            preloadModules: options.preloadModules,
            useTsx: options.useTsx,
            entryScript: options.entryScript,
        }),
        {
            cwd: options.projectRoot,
            env: options.env ?? process.env,
            stdio: options.stdio ?? "inherit",
            shell: false,
        },
    );
}

export function isChildProcessRunning(child: ChildProcess | null | undefined): child is ChildProcess {
    return child != null && child.exitCode == null && !child.killed;
}
