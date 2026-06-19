import RepoManager from "../repo/repo-manager";
import { LoggerWithContext } from "../shared/log/log-manager";
import { Task, TaskStatus } from "./task.interface";
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
import { bootstrapLocalTasks, getRegisteredLocalTaskTypeKeys, runWorkerLocalTaskBootstrap } from "./local-task-registry";

interface PrepareTaskResponse {
    isSuccess: boolean;
    taskFn: ExecutableTaskFn | null;
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
 * 1. 从 task.details 取出 repo 快照与 params
 * 2. {@link RepoManager.getRepoContext} — 本地注册优先，否则拉取 Supabase 脚本并 dynamic import
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

    // Step 1: 任务详情必须携带 repo 引用与运行时参数
    const { repo: taskRepo, params: taskParams } = details;
    if (taskRepo == null || taskParams == null) {
        logger.warn("任务缺少 repo 或 params", {
            topic: "task",
            context: {
                taskId,
                taskTypeKey,
                hasRepo: taskRepo != null,
                hasParams: taskParams != null,
            },
        });
        return fail();
    }

    logger.debug("任务详情校验通过，开始解析 Repo 上下文", {
        topic: "task",
        context: {
            taskTypeKey,
            repoKey: taskRepo.value,
            repoHash: taskRepo.details?.hash ?? null,
        },
    });

    // Step 2: 本地 registry 命中 → dynamic import；否则 Supabase 拉 repo + script 行并加载
    const repoContext = await RepoManager.getRepoContext<TaskRepoContext>({
        logger,
        taskTypeKey,
        repo: taskRepo,
    });

    if (repoContext == null) {
        logger.warn("无法加载 Repo 上下文", {
            topic: "task",
            context: { taskId, taskTypeKey, repoKey: taskRepo.value },
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
    prepareTask,
    bootstrapLocalTasks,
    runWorkerLocalTaskBootstrap,
    getRegisteredLocalTaskTypeKeys,
};

export default TaskManager;
