import RepoManager from "../repo/repo-manager";
import { getScanRemoteRepoValues } from "../repo/repo.api";
import { TASK_REPO_USAGE } from "../repo/repo.interface";
import { LoggerWithContext } from "../shared/log/log-manager";
import { Task } from "./task.interface";
import { TaskFn, TaskRepoContext, TaskRunResult, ExecutableTaskFn } from "./task-repo-context";

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
    getRegisteredLocalTaskTypeKeys,
} from "./local-task-registry";
import type { BootstrapLocalTasksResult } from "./task-repo-context";

interface PrepareTaskResponse {
    isSuccess: boolean;
    taskFn: ExecutableTaskFn | null;
}

export interface RegisterTasksOptions {
    logger: LoggerWithContext;
    local?: BootstrapLocalTasksOptions;
    /** When `true` (default), union local keys with remote `Repo.value` from Supabase. */
    includeRemote?: boolean;
}

export interface RegisterTasksResult {
    availableTaskList: string[];
    local: BootstrapLocalTasksResult;
    remote: { values: string[] };
}

function logLocalBootstrap(logger: LoggerWithContext, bootstrap: BootstrapLocalTasksResult): void {
    switch (bootstrap.status) {
        case "not_configured":
            logger.info("未找到本地任務配置，跳過本地註冊", {
                topic: "task",
                context: { message: bootstrap.message },
            });
            break;
        case "failed":
            logger.warn("本地任務註冊失敗", {
                topic: "task",
                context: { message: bootstrap.message, errors: bootstrap.errors },
            });
            break;
        case "empty":
            logger.info("本地任務掃描完成，無已註冊任務", {
                topic: "task",
                context: { message: bootstrap.message, skipped: bootstrap.skipped },
            });
            break;
        case "loaded":
            logger.info("本地任務註冊完成", {
                topic: "task",
                context: {
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
            context: { usage: TASK_REPO_USAGE },
        });
        const { data, error: remoteError } = await getScanRemoteRepoValues({ usage: TASK_REPO_USAGE });
        if (remoteError) {
            throw new Error(remoteError.message);
        }
        remoteValues = data ?? [];
        logger.info("遠程 Repo 查詢完成", {
            topic: "task",
            context: { count: remoteValues.length, values: remoteValues },
        });
    }

    const availableTaskList = [...new Set([...local.registered, ...remoteValues])];
    if (availableTaskList.length === 0) {
        throw new Error("[registerTasks] 任務註冊失敗：本地與遠程均無可用任務類型");
    }

    logger.success("任務註冊完成", {
        topic: "task",
        context: {
            availableTaskList,
            localRegistered: local.registered,
            remoteValues,
        },
    });

    return {
        availableTaskList,
        local,
        remote: { values: remoteValues },
    };
}

/** 将 taskFn 与 params 闭包绑定，供 NodeManager 无参调用 `await taskFn()` */
function bindTaskFn(taskFn: TaskFn, taskParams: unknown): ExecutableTaskFn {
    const run = async () => taskFn(taskParams);
    return Object.assign(run, {
        displayName: taskFn.displayName,
        taskTypeKey: taskFn.taskTypeKey,
    });
}

/** 调用 Repo 模块导出的 taskParamsValidator；抛错视为校验失败 */
function validateTaskParams(
    validator: TaskRepoContext["taskParamsValidator"],
    taskParams: unknown,
    logger: LoggerWithContext
): boolean {
    try {
        return validator(taskParams) === true;
    } catch (error) {
        logger.warn("taskParamsValidator 抛出异常", {
            topic: "task",
            context: { error: error instanceof Error ? error.message : error },
        });
        return false;
    }
}

/**
 * 将 Supabase 认领到的 Task 解析为可执行的 `ExecutableTaskFn`。
 *
 * 流程：
 * 1. 从 task.details 取出 `params`；`task.value` 作为 taskTypeKey（同 {@link Repo.value}）
 * 2. {@link RepoManager.getRepoContext} — 本地注册优先，否则按 task.value 拉取 Repo 并用 `details.url` 或 script 行加载
 * 3. 用 Repo 导出的 taskParamsValidator 校验 params
 * 4. 确认 taskFn 合法后 bindTaskFn，返回闭包后的无参执行函数
 *
 * 由 NodeManager.executeTask 在执行业务逻辑前调用；失败时返回 `{ isSuccess: false, taskFn: null }`。
 */
const prepareTask = async ({
    logger,
    task,
}: {
    logger: LoggerWithContext;
    task: Task;
}): Promise<PrepareTaskResponse> => {
    const fail = (): PrepareTaskResponse => ({ isSuccess: false, taskFn: null });

    const { id: taskId, name: taskName, value: taskTypeKey, details } = task;
    logger.info(`开始准备任务 ${taskName}-${taskTypeKey}`, {
        topic: "task",
        context: { taskId, taskName, taskTypeKey },
    });

    // Step 1: 任务详情必须携带运行时参数
    const { params: taskParams } = details;
    if (taskParams == null) {
        logger.warn("任务缺少 params", {
            topic: "task",
            context: { taskId, taskTypeKey },
        });
        return fail();
    }

    logger.debug("任务详情校验通过，开始解析 Repo 上下文", {
        topic: "task",
        context: { taskTypeKey },
    });

    // Step 2: 本地 registry 优先；远程按 task.value 查 Repo，从 script 行或 Repo.details.url 加载
    const repoContext = await RepoManager.getRepoContext<TaskRepoContext>({
        logger,
        taskTypeKey,
    });

    if (repoContext == null) {
        logger.warn("无法加载 Repo 上下文", {
            topic: "task",
            context: { taskId, taskTypeKey },
        });
        return fail();
    }

    logger.info("Repo 上下文加载成功", {
        topic: "task",
        context: {
            taskTypeKey,
            taskFnDisplayName: repoContext.taskFn.displayName,
        },
    });

    // Step 3: 用 Repo 模块自带的 validator 校验 params 形状
    logger.debug("开始校验任务参数", { topic: "task", context: { taskTypeKey } });
    if (!validateTaskParams(repoContext.taskParamsValidator, taskParams, logger)) {
        logger.warn("任务参数校验失败", {
            topic: "task",
            context: { taskId, taskTypeKey },
        });
        return fail();
    }

    logger.debug("任务参数校验通过", { topic: "task", context: { taskTypeKey } });

    // Step 4: 确认导出的 taskFn 可调用
    if (typeof repoContext.taskFn !== "function") {
        logger.warn("任务函数不合法", {
            topic: "task",
            context: { taskId, taskTypeKey, taskFnType: typeof repoContext.taskFn },
        });
        return fail();
    }

    // Step 5: 闭包绑定 params，供 executeTask 直接 `await taskFn()` 执行
    const boundTaskFn = bindTaskFn(repoContext.taskFn, taskParams);
    logger.success("任务准备完成", {
        topic: "task",
        context: {
            taskId,
            taskTypeKey,
            displayName: boundTaskFn.displayName,
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
};

export default TaskManager;
