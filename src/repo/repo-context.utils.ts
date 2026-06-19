import {
    TASK_REPO_SCRIPT_CATEGORY,
    type TaskRepoContext,
    type TaskRepoScriptDetails,
    type TaskRepoScriptRecord,
} from "../task/task-repo-context";

export { TASK_REPO_SCRIPT_CATEGORY };

export interface LoadedRepoContext {
    context: TaskRepoContext;
    /** Cache key segment — typically repo hash or script hash */
    contentHash: string;
}

export function isTaskRepoContext(value: unknown): value is TaskRepoContext {
    if (value == null || typeof value !== "object") {
        return false;
    }
    const record = value as TaskRepoContext;
    return typeof record.taskParamsValidator === "function" && typeof record.taskFn === "function";
}

/**
 * Normalize a dynamically imported module into {@link TaskRepoContext}.
 * Supported shapes:
 * - `export default { taskParamsValidator, taskFn }`
 * - `export { taskParamsValidator, taskFn }`
 * - `export default taskFn` (validator becomes `() => true`)
 */
export function normalizeRepoContextModule(
    moduleExports: unknown,
    taskTypeKey: string,
    exportName?: string
): TaskRepoContext | null {
    if (moduleExports == null) {
        return null;
    }

    const record = moduleExports as Record<string, unknown>;
    const namedExport =
        exportName != null && exportName !== "" ? record[exportName] : undefined;
    const defaultExport = record.default;
    const candidate = namedExport ?? defaultExport ?? moduleExports;

    let taskParamsValidator: unknown;
    let taskFn: unknown;

    if (typeof candidate === "function") {
        taskFn = candidate;
        taskParamsValidator = record.taskParamsValidator;
    } else if (typeof candidate === "object" && candidate != null) {
        const ctx = candidate as Record<string, unknown>;
        taskParamsValidator = ctx.taskParamsValidator;
        taskFn = ctx.taskFn;
    }

    taskParamsValidator ??= record.taskParamsValidator;
    taskFn ??= record.taskFn;

    if (typeof taskFn !== "function") {
        return null;
    }

    if (typeof taskParamsValidator !== "function") {
        taskParamsValidator = () => true;
    }

    const fn = taskFn as TaskRepoContext["taskFn"];
    if (fn.displayName == null || fn.displayName === "") {
        fn.displayName = taskTypeKey;
    }
    if (fn.taskTypeKey == null || fn.taskTypeKey === "") {
        fn.taskTypeKey = taskTypeKey;
    }

    return {
        taskParamsValidator: taskParamsValidator as TaskRepoContext["taskParamsValidator"],
        taskFn: fn,
    };
}

export function pickEntryScript(scripts: TaskRepoScriptRecord[]): TaskRepoScriptRecord | null {
    if (scripts.length === 0) {
        return null;
    }
    const entry = scripts.find((script) => script.details.isEntry === true);
    return entry ?? scripts[0];
}

export function getScriptLoadKey(script: TaskRepoScriptRecord): string {
    const { source, modulePath, hash } = script.details;
    if (hash != null && hash !== "") {
        return hash;
    }
    if (source != null && source !== "") {
        return `source:${source.length}:${source.slice(0, 64)}`;
    }
    if (modulePath != null && modulePath !== "") {
        return `path:${modulePath}`;
    }
    return script.id;
}

export function assertScriptLoadable(
    details: TaskRepoScriptDetails
): details is TaskRepoScriptDetails & ({ source: string } | { modulePath: string }) {
    const hasSource = details.source != null && details.source.trim() !== "";
    const hasModulePath = details.modulePath != null && details.modulePath.trim() !== "";
    return hasSource || hasModulePath;
}
