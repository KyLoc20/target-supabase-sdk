import { access, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { RepoManager } from "../repo/repo-manager";
import {
    BootstrapLocalTasksResult,
    TASK_LOCAL_PACKAGE_CONFIG_FILENAME,
    TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH,
    TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH,
    TaskLocalPackageConfig,
    TaskRunnerRootConfig,
} from "./task-repo-context";

export interface BootstrapLocalTasksOptions {
    /** Absolute or cwd-relative path to root config; if omitted, tries default paths under `cwd` */
    rootConfigPath?: string;
    /** Base directory for resolving root config (default `process.cwd()`) */
    cwd?: string;
}

const EMPTY_RESULT: BootstrapLocalTasksResult = {
    status: "not_configured",
    registered: [],
    skipped: [],
    errors: [],
};

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function importConfigModule(configPath: string): Promise<unknown> {
    const href = pathToFileURL(configPath).href;
    const mod = await import(href);
    return mod.default ?? mod;
}

function parseRootConfig(raw: unknown, configPath: string): TaskRunnerRootConfig {
    if (raw == null || typeof raw !== "object") {
        throw new Error(`Root config must export an object: ${configPath}`);
    }
    const record = raw as Record<string, unknown>;
    const taskDir = record.taskDir;
    if (typeof taskDir !== "string" || taskDir.trim() === "") {
        throw new Error(`Root config.taskDir must be a non-empty string: ${configPath}`);
    }
    return { taskDir: taskDir.trim() };
}

function parseTaskPackageConfig(raw: unknown, configPath: string): TaskLocalPackageConfig {
    if (raw == null || typeof raw !== "object") {
        throw new Error(`Task config must export an object: ${configPath}`);
    }
    const record = raw as Record<string, unknown>;
    const taskTypeKey = record.taskTypeKey;
    const entry = record.entry;

    if (typeof taskTypeKey !== "string" || taskTypeKey.trim() === "") {
        throw new Error(`taskTypeKey must be a non-empty string: ${configPath}`);
    }
    if (typeof entry !== "string" || entry.trim() === "") {
        throw new Error(`entry must be a non-empty string: ${configPath}`);
    }

    return {
        taskTypeKey: taskTypeKey.trim(),
        entry: entry.trim(),
        exportName: typeof record.exportName === "string" ? record.exportName : undefined,
        displayName: typeof record.displayName === "string" ? record.displayName : undefined,
        enabled: record.enabled === false ? false : true,
    };
}

async function resolveRootConfigPath(cwd: string, rootConfigPath?: string): Promise<string | null> {
    if (rootConfigPath != null && rootConfigPath.trim() !== "") {
        const resolved = isAbsolute(rootConfigPath) ? rootConfigPath : resolve(cwd, rootConfigPath);
        return (await pathExists(resolved)) ? resolved : null;
    }

    const candidates = [
        join(cwd, TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH),
        join(cwd, TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH),
    ];

    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveEntryModulePath(taskPackageDir: string, entry: string): string {
    return isAbsolute(entry) ? entry : resolve(taskPackageDir, entry);
}

function finalizeStatus(result: Omit<BootstrapLocalTasksResult, "status">): BootstrapLocalTasksResult["status"] {
    if (result.errors.length > 0 && result.registered.length === 0) {
        return "failed";
    }
    if (result.registered.length === 0) {
        return "empty";
    }
    return "loaded";
}

/**
 * Discover local task packages from config files and register them with {@link RepoManager}.
 *
 * **Never throws** for missing root config — returns `{ status: "not_configured" }`.
 *
 * Host app layout (recommended):
 * ```
 * ./config/task.config.js       → { taskDir: "./tasks" }
 * ./tasks/my-task/task.config.js
 * ./tasks/my-task/index.mjs
 * ```
 *
 * Legacy fallback: `./task.config.js` at project root.
 */
export async function bootstrapLocalTasks(
    options: BootstrapLocalTasksOptions = {}
): Promise<BootstrapLocalTasksResult> {
    const cwd = options.cwd ?? process.cwd();

    const rootConfigPath = await resolveRootConfigPath(cwd, options.rootConfigPath);
    if (rootConfigPath == null) {
        return {
            ...EMPTY_RESULT,
            message: `No root config (tried ${TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH}, ${TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH})`,
        };
    }

    const result: Omit<BootstrapLocalTasksResult, "status"> = {
        registered: [],
        skipped: [],
        errors: [],
    };

    try {
        const rootConfigDir = dirname(rootConfigPath);
        const rootRaw = await importConfigModule(rootConfigPath);
        const { taskDir } = parseRootConfig(rootRaw, rootConfigPath);

        const tasksRoot = isAbsolute(taskDir) ? taskDir : resolve(rootConfigDir, taskDir);
        if (!(await pathExists(tasksRoot))) {
            return {
                status: "failed",
                message: `taskDir does not exist: ${tasksRoot}`,
                ...result,
            };
        }

        const entries = await readdir(tasksRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const taskPackageDir = join(tasksRoot, entry.name);
            const taskConfigPath = join(taskPackageDir, TASK_LOCAL_PACKAGE_CONFIG_FILENAME);

            if (!(await pathExists(taskConfigPath))) {
                result.skipped.push({ taskDir: taskPackageDir, reason: "missing task.config.js" });
                continue;
            }

            try {
                const taskRaw = await importConfigModule(taskConfigPath);
                const taskConfig = parseTaskPackageConfig(taskRaw, taskConfigPath);

                if (taskConfig.enabled === false) {
                    result.skipped.push({ taskDir: taskPackageDir, reason: "disabled in task.config.js" });
                    continue;
                }

                const entryPath = resolveEntryModulePath(taskPackageDir, taskConfig.entry);
                if (!(await pathExists(entryPath))) {
                    throw new Error(`entry module not found: ${entryPath}`);
                }

                RepoManager.registerLocalModule(taskConfig.taskTypeKey, entryPath, taskConfig.exportName);
                result.registered.push(taskConfig.taskTypeKey);
            } catch (error) {
                result.errors.push({
                    taskDir: taskPackageDir,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const status = finalizeStatus(result);
        return {
            status,
            message:
                status === "empty"
                    ? `Root config loaded but no tasks registered under ${tasksRoot}`
                    : undefined,
            ...result,
        };
    } catch (error) {
        return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
            ...result,
        };
    }
}

export function getRegisteredLocalTaskTypeKeys(): string[] {
    return RepoManager.getRegisteredLocalTaskTypeKeys();
}

export { TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH };
