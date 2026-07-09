import { type RepoContextFailureReason, RepoManager } from "../repo/repo-manager";
import type { LoggerWithScope } from "../shared/log";
import { type BootstrapLocalTasksOptions, bootstrapLocalTasks } from "./local-task-registry";
import { ResultCode } from "./task.interface";
import type { TaskRepoContext } from "./task-repo-context";

export type TaskRepoValidationFailureReason =
    | "MISSING_PARAMS"
    | RepoContextFailureReason
    | "PARAMS_VALIDATION_FAILED"
    | "TASK_TYPE_KEY_MISMATCH";

export type ValidateTaskRepoAndParamsInput = {
    logger: LoggerWithScope;
    taskTypeKey: string;
    params: unknown;
    /**
     * When true, run {@link bootstrapLocalTasks} before resolve (CLI / Trigger / postTask).
     * Worker paths should omit — {@link TaskManager.registerTasks} already bootstrapped.
     */
    bootstrapLocal?: boolean;
    bootstrapLocalOptions?: BootstrapLocalTasksOptions;
    /**
     * When false, do not fetch Repo from Supabase if the task type is not locally registered.
     * Default `true`. Align with {@link RegisterTasksOptions.includeRemote}.
     */
    includeRemote?: boolean;
};

export type ValidateTaskRepoAndParamsFailure = {
    isValid: false;
    code: ResultCode;
    message: string;
    reason: TaskRepoValidationFailureReason;
    step: string;
};

export type ValidateTaskRepoAndParamsSuccess = {
    isValid: true;
    repoContext: TaskRepoContext;
};

export type ValidateTaskRepoAndParamsResult = ValidateTaskRepoAndParamsFailure | ValidateTaskRepoAndParamsSuccess;

function validateTaskParams(
    validator: TaskRepoContext["taskParamsValidator"],
    taskParams: unknown,
    logger: LoggerWithScope,
): boolean {
    try {
        return validator(taskParams) === true;
    } catch (error) {
        logger.warn("taskParamsValidator 拋出異常", {
            topic: "task",
            data: { error: error instanceof Error ? error.message : error },
        });
        return false;
    }
}

function invalid(params: {
    reason: TaskRepoValidationFailureReason;
    code: ResultCode;
    message: string;
    step: string;
}): ValidateTaskRepoAndParamsFailure {
    return { isValid: false, ...params };
}

/**
 * Resolve task Repo context and validate `params` via `taskParamsValidator`.
 *
 * Repo resolution uses {@link RepoManager.getRepoContext}:
 * local registry first; when no local entry and `includeRemote`, loads from Supabase.
 */
async function validateTaskRepoAndParams({
    logger,
    taskTypeKey,
    params,
    bootstrapLocal = false,
    bootstrapLocalOptions,
    includeRemote = true,
}: ValidateTaskRepoAndParamsInput): Promise<ValidateTaskRepoAndParamsResult> {
    if (params == null) {
        return invalid({
            reason: "MISSING_PARAMS",
            code: ResultCode.PARAMS_NOT_VALID,
            message: "任務缺少 params",
            step: "params",
        });
    }

    if (bootstrapLocal) {
        const bootstrap = await bootstrapLocalTasks({
            ...bootstrapLocalOptions,
            forTaskTypeKey: taskTypeKey,
        });
        logger.debug("本地任務 bootstrap 完成", {
            topic: "task",
            data: {
                taskTypeKey,
                step: "local_bootstrap",
                status: bootstrap.status,
                registered: bootstrap.registered,
                cached: bootstrap.cached ?? false,
                message: bootstrap.message,
            },
        });
    }

    logger.debug("開始解析 Repo 上下文", {
        topic: "task",
        data: { taskTypeKey, step: "repo_load", includeRemote },
    });

    const {
        context: repoContext,
        error: repoError,
        failureReason,
        resolvedVia,
    } = await RepoManager.getRepoContext<TaskRepoContext>({
        logger,
        taskTypeKey,
        includeRemote,
    });

    if (repoContext == null) {
        return invalid({
            reason: failureReason ?? "REMOTE_REPO_LOAD_FAILED",
            code: ResultCode.REPO_NOT_VALID,
            message: repoError ?? "無法加載 Repo 上下文",
            step: "repo_load",
        });
    }

    logger.debug("Repo 上下文解析完成", {
        topic: "task",
        data: { taskTypeKey, step: "repo_load", resolvedVia },
    });

    if (repoContext.taskFn.taskTypeKey !== taskTypeKey) {
        return invalid({
            reason: "TASK_TYPE_KEY_MISMATCH",
            code: ResultCode.REPO_NOT_VALID,
            message: `taskFn.taskTypeKey (${repoContext.taskFn.taskTypeKey}) 與 task.value (${taskTypeKey}) 不一致`,
            step: "task_type_key",
        });
    }

    logger.debug("開始校驗任務參數", { topic: "task", data: { taskTypeKey, step: "params_validation" } });
    if (!validateTaskParams(repoContext.taskParamsValidator, params, logger)) {
        return invalid({
            reason: "PARAMS_VALIDATION_FAILED",
            code: ResultCode.PARAMS_NOT_VALID,
            message: "任務參數校驗失敗",
            step: "params_validation",
        });
    }

    logger.debug("任務參數校驗通過", { topic: "task", data: { taskTypeKey, step: "params_validation" } });

    return { isValid: true, repoContext };
}

const TaskRepoValidation = {
    validate: validateTaskRepoAndParams,
};

export { TaskRepoValidation, validateTaskRepoAndParams };
