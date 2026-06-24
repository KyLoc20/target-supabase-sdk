export interface TaskRunResult {
    isSuccess: boolean;
    cost: number;
    extra: unknown;
}

export interface TaskFn {
    displayName: string;
    taskTypeKey: string;
    (taskParams: unknown): Promise<TaskRunResult>;
}

/** Params already bound — used by node executor after prepareTask */
export type ExecutableTaskFn = (() => Promise<TaskRunResult>) & {
    displayName: string;
    taskTypeKey: string;
};

/** Repo script module must expose this shape (see repo-context.utils). */
export interface TaskRepoContext {
    taskParamsValidator: (taskParams: unknown) => boolean;
    taskFn: TaskFn;
}

/** Supabase `target.category` for rows that store task script payloads */
export const TASK_REPO_SCRIPT_CATEGORY = "script" as const;

/**
 * `target.details` for task script rows — not a separate Target subtype in repo.interface.
 * Loaded dynamically to produce {@link TaskRepoContext}.
 */
export interface TaskRepoScriptDetails {
    manifestVersion: number;
    /** Inline ESM source — written to temp file then dynamically imported (Node) */
    source?: string;
    /** Absolute path to an ESM module on the worker machine */
    modulePath?: string;
    /** Named export to read TaskRepoContext from; default export if omitted */
    exportName?: string;
    /** Content hash for cache invalidation */
    hash?: string;
    /** Prefer this script as entry when multiple scripts exist for one repo */
    isEntry?: boolean;
}

/** Minimal target row shape used by script loader (avoids a dedicated Script Target type). */
export interface TaskRepoScriptRecord {
    id: string;
    value: string;
    details: TaskRepoScriptDetails;
}

/** Host app root config at `config/task.config.js` — where to discover local task packages */
export interface TaskRunnerRootConfig {
    /** Directory containing one folder per task (relative to root config file), e.g. `"./tasks"` */
    taskDir: string;
}

/** Per-task `task.config.js` inside `<taskDir>/<name>/` */
export interface TaskLocalPackageConfig {
    /** Must match `task.value` when claiming from Supabase */
    taskTypeKey: string;
    /** Entry module relative to this task folder, e.g. `"./index.mjs"` */
    entry: string;
    /** Named export on entry module; default export if omitted */
    exportName?: string;
    displayName?: string;
    /** Skip registration when `false` (default `true`) */
    enabled?: boolean;
}

export type BootstrapLocalTasksStatus =
    /** Root config found and scan finished (individual tasks may still have errors) */
    | "loaded"
    /** Root config found but zero tasks registered */
    | "empty"
    /** No root config at default/explicit paths — not an error; use remote scripts or manual register */
    | "not_configured"
    /** Root config or taskDir invalid */
    | "failed";

export interface BootstrapLocalTasksResult {
    status: BootstrapLocalTasksStatus;
    /** Human-readable summary for logs */
    message?: string;
    registered: string[];
    skipped: { taskDir: string; reason: string }[];
    errors: { taskDir: string; error: string }[];
}

/** Host app config directory (relative to `cwd`) — recommended for library consumers */
export const TASK_RUNNER_CONFIG_DIR = "config" as const;

export const TASK_RUNNER_ROOT_CONFIG_FILENAME = "task.config.js" as const;

/** Default root config path: `config/task.config.js` */
export const TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH = `${TASK_RUNNER_CONFIG_DIR}/${TASK_RUNNER_ROOT_CONFIG_FILENAME}` as const;

/** Legacy fallback at project root */
export const TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH = TASK_RUNNER_ROOT_CONFIG_FILENAME;

/** Per-task config filename inside each folder under `taskDir` */
export const TASK_LOCAL_PACKAGE_CONFIG_FILENAME = "task.config.js" as const;
