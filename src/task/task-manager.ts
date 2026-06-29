import { getScanRemoteRepoValues } from "../repo/repo.api";
import { TASK_REPO_USAGE } from "../repo/repo.interface";
import { LoggerWithScope } from "../shared/log";
import { ResultCode, Task } from "./task.interface";
import { TaskFn, TaskRunResult, ExecutableTaskFn } from "./task-repo-context";

export type {
    TaskFn,
    TaskRepoContext,
    TaskRunResult,
    ExecutableTaskFn,
    TaskRepoScriptDetails,
    TaskRepoScriptRecord,
    TaskRunnerRootConfig,
    TaskLocalPackageConfig,
    BootstrapLocalTasksResult,
    BootstrapLocalTasksStatus,
} from "./task-repo-context";
export {
    TASK_REPO_SCRIPT_CATEGORY,
    TASK_RUNNER_CONFIG_DIR,
    TASK_RUNNER_ROOT_CONFIG_FILENAME,
    TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH,
    TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH,
    TASK_LOCAL_PACKAGE_CONFIG_FILENAME,
} from "./task-repo-context";
import {
    bootstrapLocalTasks,
    BootstrapLocalTasksOptions,
    clearBootstrapLocalTasksCache,
    getRegisteredLocalTaskTypeKeys,
} from "./local-task-registry";
import type { BootstrapLocalTasksResult } from "./task-repo-context";
import { TaskRepoValidation, type TaskRepoValidationFailureReason } from "./task-repo-validation";

/** @deprecated use {@link TaskRepoValidationFailureReason} */
export type PrepareTaskFailureReason = TaskRepoValidationFailureReason;

export type {
    TaskRepoValidationFailureReason,
    ValidateTaskRepoAndParamsInput,
    ValidateTaskRepoAndParamsResult,
} from "./task-repo-validation";
export { TaskRepoValidation } from "./task-repo-validation";

export interface PrepareTaskResponse {
    isSuccess: boolean;
    taskFn: ExecutableTaskFn | null;
    code?: ResultCode;
    message?: string;
    reason?: PrepareTaskFailureReason;
    /** Pipeline step for log aggregation */
    step?: string;
}

export interface PrepareTaskParams {
    logger: LoggerWithScope;
    task: Task;
    /**
     * When false, do not fetch Repo from Supabase during validation.
     * Should match {@link RegisterTasksOptions.includeRemote} on the worker.
     */
    includeRemote?: boolean;
    bootstrapLocalOptions?: BootstrapLocalTasksOptions;
}

export interface RegisterTasksOptions {
    logger: LoggerWithScope;
    local?: BootstrapLocalTasksOptions;
    /** When `true` (default), union local keys with remote `Repo.value` from Supabase. */
    includeRemote?: boolean;
}

export interface RegisterTasksResult {
    availableTaskList: string[];
    local: BootstrapLocalTasksResult;
    remote: { values: string[] };
    includeRemote: boolean;
}

function logLocalBootstrap(logger: LoggerWithScope, bootstrap: BootstrapLocalTasksResult): void {
    switch (bootstrap.status) {
        case "not_configured":
            logger.info("未找到本地任務配置，跳過本地註冊", {
                topic: "task",
                data: { message: bootstrap.message },
            });
            break;
        case "failed":
            logger.warn("本地任務註冊失敗", {
                topic: "task",
                data: { message: bootstrap.message, errors: bootstrap.errors },
            });
            break;
        case "empty":
            logger.info("本地任務掃描完成，無已註冊任務", {
                topic: "task",
                data: { message: bootstrap.message, skipped: bootstrap.skipped },
            });
            break;
        case "loaded":
            logger.info("本地任務註冊完成", {
                topic: "task",
                data: {
                    registered: bootstrap.registered,
                    skipped: bootstrap.skipped,
                    errors: bootstrap.errors,
                },
            });
            break;
    }
}

/**
 * Worker startup: discover local task packages + remote Repo rows, merge into `availableTaskList`.
 *
 * - Local: {@link bootstrapLocalTasks} → registers modules in {@link RepoManager}
 * - Remote: {@link getScanRemoteRepoValues} with {@link TASK_REPO_USAGE}
 * - Merge: union of both; execution still prefers local registry in {@link RepoManager.getRepoContext}
 *
 * @throws When merged list is empty (no task types to claim).
 */
async function registerTasks({
    logger,
    local: localOptions,
    includeRemote = true,
}: RegisterTasksOptions): Promise<RegisterTasksResult> {
    logger.info("開始註冊任務（本地 + 遠程）", { topic: "task" });

    const local = await bootstrapLocalTasks(localOptions ?? {});
    logLocalBootstrap(logger, local);

    let remoteValues: string[] = [];
    if (includeRemote) {
        logger.info("查詢遠程 Repo 列表", {
            topic: "task",
            data: { usage: TASK_REPO_USAGE },
        });
        const { data, error: remoteError } = await getScanRemoteRepoValues({ usage: TASK_REPO_USAGE });
        if (remoteError) {
            throw new Error(remoteError.message);
        }
        remoteValues = data ?? [];
        logger.info("遠程 Repo 查詢完成", {
            topic: "task",
            data: { count: remoteValues.length, values: remoteValues },
        });
    }

    const availableTaskList = [...new Set([...local.registered, ...remoteValues])];
    if (availableTaskList.length === 0) {
        throw new Error("[registerTasks] 任務註冊失敗：本地與遠程均無可用任務類型");
    }

    logger.success("任務註冊完成", {
        topic: "task",
        data: {
            availableTaskList,
            localRegistered: local.registered,
            remoteValues,
        },
    });

    return {
        availableTaskList,
        local,
        remote: { values: remoteValues },
        includeRemote,
    };
}

/** 将 taskFn 与 params 闭包绑定，供 TaskNode 无参调用 `await taskFn()` */
function bindTaskFn(taskFn: TaskFn, taskParams: unknown): ExecutableTaskFn {
    const run = async () => taskFn(taskParams);
    return Object.assign(run, {
        displayName: taskFn.displayName,
        taskTypeKey: taskFn.taskTypeKey,
    });
}

/**
 * 將 Supabase 認領到的 Task 解析為可執行的 `ExecutableTaskFn`。
 *
 * 流程：
 * 1. 從 task.details 取出 `params`；`task.value` 作為 taskTypeKey（同 {@link Repo.value}）
 * 2. {@link TaskRepoValidation.validate} — 本地註冊優先；未命中時可選遠端（`includeRemote`）
 *    Worker 在 registry 未命中時會補掃本地（`local_bootstrap_on_miss`）
 * 3. bindTaskFn，返回閉包後的無參執行函數
 *
 * 失敗時返回 `{ isSuccess: false, code, message, reason, step }`（不 throw）。
 */
const prepareTask = async ({
    logger,
    task,
    includeRemote = true,
    bootstrapLocalOptions,
}: PrepareTaskParams): Promise<PrepareTaskResponse> => {
    const fail = (params: {
        reason: PrepareTaskFailureReason;
        code: ResultCode;
        message: string;
        step: string;
    }): PrepareTaskResponse => {
        logger.warn(params.message, {
            topic: "task",
            data: {
                taskId: task.id,
                taskTypeKey: task.value,
                reason: params.reason,
                step: params.step,
            },
        });
        return {
            isSuccess: false,
            taskFn: null,
            code: params.code,
            message: params.message,
            reason: params.reason,
            step: params.step,
        };
    };

    const { id: taskId, name: taskName, value: taskTypeKey, details } = task;
    logger.info(`開始準備任務 ${taskName}-${taskTypeKey}`, {
        topic: "task",
        data: { taskId, taskName, taskTypeKey },
    });

    const { params: taskParams } = details;

    if (!getRegisteredLocalTaskTypeKeys().includes(taskTypeKey)) {
        const bootstrap = await bootstrapLocalTasks({
            ...bootstrapLocalOptions,
            forTaskTypeKey: taskTypeKey,
        });
        logger.debug("本地 registry 未命中，補掃本地任務", {
            topic: "task",
            data: {
                taskId,
                taskTypeKey,
                step: "local_bootstrap_on_miss",
                status: bootstrap.status,
                registered: bootstrap.registered,
                cached: bootstrap.cached ?? false,
                message: bootstrap.message,
            },
        });
    }

    const validation = await TaskRepoValidation.validate({
        logger,
        taskTypeKey,
        params: taskParams,
        includeRemote,
    });
    if (!validation.isValid) {
        return fail({
            reason: validation.reason,
            code: validation.code,
            message: validation.message,
            step: validation.step,
        });
    }

    const { repoContext } = validation;

    logger.info("Repo 上下文加載成功", {
        topic: "task",
        data: {
            taskTypeKey,
            taskFnDisplayName: repoContext.taskFn.displayName,
            step: "repo_load",
        },
    });

    const boundTaskFn = bindTaskFn(repoContext.taskFn, taskParams);
    logger.success("任務準備完成", {
        topic: "task",
        data: {
            taskId,
            taskTypeKey,
            displayName: boundTaskFn.displayName,
            step: "bind",
        },
    });

    return {
        isSuccess: true,
        taskFn: boundTaskFn,
    };
};

const TaskManager = {
    registerTasks,
    prepareTask,
    bootstrapLocalTasks,
    getRegisteredLocalTaskTypeKeys,
    clearBootstrapLocalTasksCache,
};

export { TaskManager };
