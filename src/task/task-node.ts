import {
    createLogger,
    createScope,
    withModule,
    type LoggerWithScope,
} from "../shared/log";
import { getErrorMessage, toError } from "../shared/utils/error.utils";
import { isOptimisticLockResponse } from "../core.api";
import { BaseNodeRuntime, LOG_TOPIC_NODE, type NodeLoopContext } from "../node/node-runtime.base";
import { TaskManager, type TaskRunResult } from "./task-manager";
import { patchChangeTaskStatus, patchClaimTask } from "./task.api";
import { TaskStatusAction } from "./task.interface";

import { CRITICAL_UNKNOWN_TASK_TRACE_ID, LOG_TOPIC_TASK } from "./task.constant";

/**
 * Task worker node: commands → heartbeat → claim & execute tasks.
 * Built on {@link BaseNodeRuntime}.
 */
class TaskNode extends BaseNodeRuntime {
    private _availableTaskList: string[] = [];
    private _includeRemote = true;

    get availableTaskList(): readonly string[] {
        return [...this._availableTaskList];
    }

    constructor() {
        super("taskNode");
    }

    protected async onBeforeRegisterNode(logger: LoggerWithScope): Promise<void> {
        const { availableTaskList, includeRemote } = await TaskManager.registerTasks({ logger });
        this._availableTaskList = availableTaskList;
        this._includeRemote = includeRemote;
    }

    protected async runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void> {
        if (!heartbeatOk) {
            const logger = createLogger({
                scope: createScope({
                    module: `${this.runtimeModule}-runLoopSteps`,
                    traceId: ctx.loopTraceId,
                    labels: { nodeId: ctx.nodeId },
                })
            });
            logger.warn("心跳失敗，本輪跳過任務認領", { topic: LOG_TOPIC_NODE });
            return;
        }
        await this.runAsWorker(ctx);
    }

    private async runAsWorker(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId, nodeId } = ctx;
        const loopScope = createScope({ module: "runAsWorker", traceId: loopTraceId, labels: { nodeId } });
        const logger = createLogger({ scope: loopScope });

        const availableTaskList = this.availableTaskList;
        if (availableTaskList.length === 0) {
            logger.warn("未配置可認領任務類型，跳過本輪", { topic: LOG_TOPIC_TASK });
            return;
        }

        logger.debug("向 Supabase 認領任務", {
            topic: LOG_TOPIC_TASK,
            data: { availableTaskList },
        });
        const { data: task, error: claimError } = await patchClaimTask({
            nodeId,
            availableTaskList: [...availableTaskList],
            traceId: loopTraceId,
        });
        if (claimError) {
            if (isOptimisticLockResponse(claimError)) {
                logger.debug("認領競爭失敗，本輪無可認領任務", {
                    topic: LOG_TOPIC_TASK,
                    data: { availableTaskList },
                });
                return;
            }
            logger.error("認領任務失敗", {
                topic: LOG_TOPIC_TASK,
                data: {
                    availableTaskList,
                    error: claimError.message,
                    code: claimError.code,
                },
            });
            return;
        }
        if (task == null) {
            logger.debug("本輪無匹配的 TODO 任務", {
                topic: LOG_TOPIC_TASK,
                data: { availableTaskList },
            });
            return;
        }

        const taskTraceId = task.details.traceId ?? CRITICAL_UNKNOWN_TASK_TRACE_ID
        const taskScope = createScope({
            module: "runAsWorker",
            traceId: loopTraceId,
            labels: { nodeId },
            traceParentId: taskTraceId,
        });
        const taskLogger = createLogger({ scope: taskScope });
        taskLogger.success("認領任務成功，準備執行", {
            topic: LOG_TOPIC_TASK,
            data: {
                taskId: task.id,
                taskName: task.name,
                taskTypeKey: task.value,
                taskStatus: task.details.status,
            },
        });

        const prepareLogger = createLogger({ scope: withModule(taskScope, "prepareTask") });
        const prepareResult = await TaskManager.prepareTask({
            logger: prepareLogger,
            task,
            includeRemote: this._includeRemote,
        });
        const { isSuccess: isPrepareSuccess, taskFn, code, message, reason, step } = prepareResult;
        if (!isPrepareSuccess || taskFn == null) {
            prepareLogger.critical("任務準備失敗，無法繼續執行，中止任務並 RESET 為 OPEN", {
                topic: LOG_TOPIC_TASK,
                data: {
                    taskId: task.id,
                    taskTypeKey: task.value,
                    code,
                    message,
                    reason,
                    step,
                },
            });
            await this.abortTaskRun({
                logger: prepareLogger,
                taskId: task.id,
                nodeId,
                traceId: taskTraceId,
            });
            return;
        }
        logger.success("任務準備完成", {
            topic: LOG_TOPIC_TASK,
            data: {
                taskId: task.id,
                taskName: task.name,
                taskTypeKey: task.value,
                displayName: taskFn.displayName,
            },
        });

        const executeLogger = createLogger({ scope: withModule(taskScope, "executeTask") });
        const onExecuteAbort = async (error?: Error) => {
            executeLogger.critical("任務執行遇到未知錯誤，中止任務並 RESET 為 OPEN", {
                topic: LOG_TOPIC_TASK,
                data: {
                    taskId: task.id,
                    taskTypeKey: task.value,
                    taskName: task.name,
                    displayName: taskFn.displayName,
                    error: getErrorMessage(error),
                },
            });
            await this.abortTaskRun({
                logger: executeLogger,
                taskId: task.id,
                nodeId,
                traceId: taskTraceId,
            });
        };

        executeLogger.info("開始執行業務邏輯", {
            topic: LOG_TOPIC_TASK,
            data: { taskId: task.id, displayName: taskFn.displayName },
        });
        const startTime = Date.now();
        let result: TaskRunResult | null = null;
        try {
            result = await taskFn();
        } catch (error) {
            await onExecuteAbort(toError(error));
            return;
        }
        if (result == null) {
            await onExecuteAbort(new Error("任務執行結果為空"));
            return;
        }

        const { isSuccess: isTaskSuccess, cost, extra } = result ?? { isSuccess: false, cost: 0, extra: null };
        if (isTaskSuccess) {
            await this.finalizeTaskRun("success", {
                logger: executeLogger,
                taskId: task.id,
                taskTypeKey: task.value,
                nodeId,
                cost,
                extra,
                traceId: taskTraceId,
            });
        } else {
            await this.finalizeTaskRun("failure", {
                logger: executeLogger,
                taskId: task.id,
                taskTypeKey: task.value,
                nodeId,
                cost,
                extra,
                traceId: taskTraceId,
            });
        }
        const duration = Date.now() - startTime;
        executeLogger.info("業務邏輯執行結束", {
            topic: LOG_TOPIC_TASK,
            data: { taskId: task.id, taskName: task.name, taskTypeKey: task.value, displayName: taskFn.displayName, durationMs: duration },
        });
    }

    private async abortTaskRun(params: {
        logger: LoggerWithScope;
        taskId: string;
        nodeId: string;
        traceId: string;
        extra?: TaskRunResult["extra"];
    }): Promise<boolean> {
        const { logger, taskId, nodeId, traceId, extra } = params;
        const logData = { taskId, nodeId };
        const extraValue = typeof extra === "string" ? extra : undefined;

        const { error } = await patchChangeTaskStatus({
            id: taskId,
            action: TaskStatusAction.RESET,
            nodeId,
            extra: extraValue,
            traceId,
        });

        if (error) {
            logger.error(error.message, { topic: LOG_TOPIC_TASK, data: logData });
            return false;
        }
        logger.info("任務已中止並 RESET 為 OPEN", { topic: LOG_TOPIC_TASK, data: logData });
        return true;
    }

    private async finalizeTaskRun(
        outcome: "success" | "failure",
        params: {
            logger: LoggerWithScope;
            taskId: string;
            taskTypeKey: string;
            nodeId: string;
            cost: TaskRunResult["cost"];
            extra: TaskRunResult["extra"];
            traceId: string;
        }
    ): Promise<void> {
        const { logger, taskId, nodeId, taskTypeKey, cost, extra, traceId } = params;
        const outcomePrefix = outcome === "success" ? "任務成功" : "任務失敗";
        const logData = {
            taskTypeKey,
            taskId,
            nodeId,
            ...(extra != null && extra !== "" ? { extra } : {}),
        };
        const extraValue = typeof extra === "string" ? extra : undefined;

        const { error: changeTaskStatusError } =
            outcome === "success"
                ? await patchChangeTaskStatus({
                    id: taskId,
                    action: TaskStatusAction.FINISH,
                    nodeId,
                    cost,
                    extra: extraValue,
                    traceId,
                })
                : await patchChangeTaskStatus({
                    id: taskId,
                    action: TaskStatusAction.RESET,
                    nodeId,
                    extra: extraValue,
                    traceId,
                });

        if (changeTaskStatusError) {
            const upperMessage = `${outcomePrefix}但是更新 TaskStatus 失敗，產生孤兒 Task，請儘快排查問題`;
            logger.critical(upperMessage, { topic: LOG_TOPIC_TASK, data: logData });
            // TODO: 需要處理孤兒 Task
            throw new Error(upperMessage);
        }
        logger.info("更新 TaskStatus 成功", { topic: LOG_TOPIC_TASK, data: logData });
        if (outcome === "success") {
            logger.success("任務執行結束，業務邏輯成功", { topic: LOG_TOPIC_TASK, data: logData });
        } else {
            logger.warn("任務執行結束，業務邏輯失敗", { topic: LOG_TOPIC_TASK, data: logData });
        }
    }
}

export { TaskNode };
