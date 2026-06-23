import { MAX_POLL_TARGET_LIST_SIZE } from "../core.api";
import { getPollCommandList } from "../command/command.api";
import { CommandType } from "../command/command.interface";
import logManager, { type LoggerWithContext } from "../shared/log/log-manager";
import { getErrorMessage, toError } from "../shared/utils/error.utils";
import TaskManager, { TaskRunResult } from "../task/task-manager";
import { patchChangeTaskStatus, patchClaimTask } from "../task/task.api";
import { TaskStatusAction } from "../task/task.interface";
import { patchChangeNodeStatus, patchNodeHeartBeat, patchStopNode, postRegisterNode } from "./node.api";
import { NodeLoopContext, NodeStatus } from "./node.interface";
import { formatHeartbeat, getRandomInterval } from "./node.utils";

export class NodeManager {
    private static readonly HEARTBEAT_FAILURE_THRESHOLD = 3;

    private _localNodeId: string | null = null;
    private _isNodeIdLocked: boolean = false;
    private _availableTaskList: string[] = [];

    private isRunning: boolean;
    private loopCount: number;
    private consecutiveHeartbeatFailures = 0;
    /** 進程生命週期 traceId — bootstrap / register / shutdown 共用 */
    private readonly startupTraceId: string;
    /** 進行中的 shutdown；並發/重複調用復用同一 Promise。 */
    private shutdownPromise: Promise<void> | null = null;
    /** start() 冪等：重複調用復用同一 Promise。 */
    private startPromise: Promise<void> | null = null;

    get availableTaskList(): readonly string[] {
        return [...this._availableTaskList];
    }
    set availableTaskList(value: string[]) {
        this._availableTaskList = value;
    }

    get localNodeId(): string | null {
        return this._localNodeId;
    }
    set localNodeId(value: string) {
        if (this._isNodeIdLocked) {
            throw new Error("Node ID cannot be modified after initial assignment");
        }
        if (typeof value !== "string" || value.trim() === "") {
            throw new Error("Invalid node ID");
        }

        this._localNodeId = value;
        this._isNodeIdLocked = true;
    }

    constructor() {
        this.isRunning = true;
        this.loopCount = 0;
        this.startupTraceId = logManager.generateTraceId();
    }

    private getLogNodeId(): string {
        return this.localNodeId ?? "bootstrap";
    }

    private isShuttingDown(): boolean {
        return this.shutdownPromise != null;
    }

    /** Fire-and-forget：供信號/致命路徑調用；shutdown Promise 內部吞掉 rejection，避免 unhandledRejection 遞迴。 */
    private requestShutdown(trigger: string): void {
        void this.shutdown({ trigger });
    }

    /** 啟動日誌 + SIGTERM/SIGINT/uncaughtException/unhandledRejection → shutdown */
    private registerProcessLifecycle(logger: LoggerWithContext): void {
        process.on("SIGTERM", () => {
            logger.warn("收到 SIGTERM 信號，準備關閉節點", { topic: "process" });
            this.requestShutdown("SIGTERM");
        });
        process.on("SIGINT", () => {
            logger.warn("收到 SIGINT 信號，準備關閉節點", { topic: "process" });
            this.requestShutdown("SIGINT");
        });
        process.on("uncaughtException", (error) => {
            if (this.shutdownPromise != null) {
                logger.critical("shutdown 進行中發生未捕獲異常", {
                    topic: "process",
                    context: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    },
                });
                process.exit(1);
                return;
            }
            logger.error("未捕獲的異常，準備關閉節點", {
                topic: "process",
                context: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });
            this.requestShutdown("uncaughtException");
        });
        process.on("unhandledRejection", (reason) => {
            if (this.shutdownPromise != null) {
                logger.error("shutdown 進行中發生未處理的 Promise 拒絕", {
                    topic: "process",
                    context: {
                        reason: getErrorMessage(reason),
                        stack: reason instanceof Error ? reason.stack : undefined,
                    },
                });
                return;
            }
            logger.error("未處理的 Promise 拒絕，準備關閉節點", {
                topic: "process",
                context: {
                    reason: getErrorMessage(reason),
                    stack: reason instanceof Error ? reason.stack : undefined,
                },
            });
            this.requestShutdown("unhandledRejection");
        });
    }

    async start(): Promise<void> {
        if (this.startPromise != null) {
            return this.startPromise;
        }
        this.startPromise = this.runStart();
        return this.startPromise;
    }

    private async runStart(): Promise<void> {
        const { logger } = logManager.withContext({
            module: "nodeManager",
            traceId: this.startupTraceId,
            nodeId: this.getLogNodeId(),
        });

        logger.info("節點進程啟動中", {
            topic: "node",
            context: {
                pid: process.pid,
                env: process.env.NODE_ENV ?? "development",
            },
        });
        this.registerProcessLifecycle(logger);

        logger.info("開始掃描並註冊本地任務", { topic: "node" });
        try {
            this._availableTaskList = await TaskManager.runWorkerLocalTaskBootstrap(this._availableTaskList);
            logger.success("本地任務註冊流程完成", {
                topic: "node",
                context: { availableTaskList: this._availableTaskList },
            });
        } catch (error) {
            logger.error("本地任務註冊失敗", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
            this.requestShutdown("bootstrap:local-tasks");
            return;
        }

        logger.info("開始向 Supabase 註冊節點", { topic: "node" });
        try {
            const { data, error } = await postRegisterNode({ traceId: this.startupTraceId });
            if (data == null || error) {
                throw error ?? new Error("postRegisterNode 失敗");
            }
            this.localNodeId = data.id;
            logger.resetContext({ nodeId: data.id });
            logger.success("節點註冊成功", {
                topic: "node",
                context: {
                    nodeId: data.id,
                    details: data.details,
                },
            });
        } catch (error) {
            logger.error("節點註冊失敗", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
            this.requestShutdown("bootstrap:register-node");
            return;
        }

        const nodeId = this.localNodeId!;
        logger.info("節點準備進入主循環", { topic: "node" });
        const { error: enterBusyError } = await patchChangeNodeStatus({
            nodeId,
            status: NodeStatus.BUSY,
            fromStatus: NodeStatus.READY,
            traceId: this.startupTraceId,
        });
        if (enterBusyError) {
            logger.error("節點進入主循環失敗，無法更新節點狀態為 BUSY", {
                topic: "node",
                context: { error: enterBusyError.message },
            });
            this.requestShutdown("bootstrap:enter-busy");
            return;
        }
        logger.info("節點狀態已設為 BUSY，進入主循環", { topic: "node", context: { nodeId } });

        while (this.isRunning) {
            this.loopCount++;
            const loopTraceId = logManager.generateTraceId();
            const loopCtx: NodeLoopContext = { loopTraceId, nodeId };
            const { logger: iterLogger } = logManager.withContext({
                module: "nodeManager",
                traceId: loopTraceId,
                nodeId,
            });

            iterLogger.info(`主循環第 ${this.loopCount} 輪開始`, {
                topic: "node",
                context: { loopCount: this.loopCount },
            });
            try {
                // 每輪三步：1. 控制指令  2. 心跳  3. 認領並執行任務
                await this.batchCommand(loopCtx);
                if (this.isShuttingDown()) {
                    iterLogger.info("節點關閉中，跳過本輪剩餘步驟", { topic: "node" });
                    break;
                }
                const heartbeatOk = await this.heartbeat(loopCtx);
                if (this.isShuttingDown()) {
                    iterLogger.info("節點關閉中，跳過本輪剩餘步驟", { topic: "node" });
                    break;
                }
                if (!heartbeatOk) {
                    iterLogger.warn("心跳失敗，本輪跳過任務認領", { topic: "node" });
                } else {
                    await this.runAsWorker(loopCtx);
                }
            } catch (error) {
                iterLogger.critical(`主循環第 ${this.loopCount} 輪遇到未知錯誤`, {
                    topic: "node",
                    context: { error: getErrorMessage(error) },
                });
            }
            if (this.isShuttingDown()) {
                iterLogger.debug("節點關閉中，跳過等待間隔", { topic: "node" });
                break;
            }
            const interval = getRandomInterval();
            iterLogger.debug(`主循環第 ${this.loopCount} 輪完成，等待下一輪`, {
                topic: "node",
                context: { intervalMs: interval },
            });
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }

    async runAsWorker(ctx: NodeLoopContext) {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withContext({
            module: "runAsWorker",
            traceId: loopTraceId,
            nodeId,
        });

        const availableTaskList = this.availableTaskList;
        if (availableTaskList.length === 0) {
            logger.warn("未配置可認領任務類型，跳過本輪", { topic: "task" });
            return;
        }

        logger.info("向 Supabase 認領任務", {
            topic: "task",
            context: { availableTaskList },
        });
        const { data: task, error: claimError } = await patchClaimTask({
            nodeId,
            availableTaskList: [...availableTaskList],
            traceId: loopTraceId,
        });
        if (claimError) {
            logger.error("認領任務 API 失敗", {
                topic: "task",
                context: {
                    availableTaskList,
                    error: claimError.message,
                },
            });
            return;
        }
        if (task == null) {
            logger.info("本輪無匹配的 TODO 任務", {
                topic: "task",
                context: { availableTaskList },
            });
            return;
        }

        logger.info("認領任務成功，準備執行", {
            topic: "task",
            context: {
                taskId: task.id,
                taskName: task.name,
                taskTypeKey: task.value,
                taskStatus: task.details.status,
                repoKey: task.details.repo?.value ?? null,
            },
        });

        const { logger: prepareLogger } = logManager.withContext({
            module: "prepareTask",
            traceId: loopTraceId,
            nodeId,
        });
        const { isSuccess: isPrepareSuccess, taskFn } = await TaskManager.prepareTask({ logger: prepareLogger, task });
        if (!isPrepareSuccess || taskFn == null) {
            prepareLogger.critical("任務準備失敗，無法繼續執行，中止任務並 RESET 為 OPEN", {
                topic: "task",
                context: {
                    task
                },
            });
            await this.abortTaskRun({
                logger: prepareLogger,
                taskId: task.id,
                nodeId,
                traceId: loopTraceId,
            });
            return
        }

        const { logger: executeLogger } = logManager.withContext({
            module: "executeTask",
            traceId: loopTraceId,
            nodeId,
        });
        const onExecuteAbort = async (error?: Error) => {
            logger.critical("任務執行遇到未知錯誤，中止任務並 RESET 為 OPEN", {
                topic: "task",
                context: {
                    taskId: task.id,
                    taskName: task.name,
                    taskTypeKey: task.value,
                    error: getErrorMessage(error),
                },
            });
            await this.abortTaskRun({
                logger: executeLogger,
                taskId: task.id,
                nodeId,
                traceId: loopTraceId,
            });
        }

        executeLogger.info("開始執行業務邏輯", {
            topic: "task",
            context: { taskId: task.id, displayName: taskFn.displayName },
        });
        const startTime = Date.now();
        let result: TaskRunResult | null = null;
        try {
            result = await taskFn();
        } catch (error) {
            await onExecuteAbort(toError(error));
            return
        }
        if (result == null) {
            await onExecuteAbort(new Error("任務執行結果為空"));
            return
        }

        executeLogger.info("任務執行完成", {
            topic: "task",
            context: { taskId: task.id, displayName: taskFn.displayName },
        });
        const { isSuccess: isTaskSuccess, cost, extra } = result ?? { isSuccess: false, cost: 0, extra: null };
        if (isTaskSuccess) {
            await this.finalizeTaskRun("success", { logger: executeLogger, taskId: task.id, taskTypeKey: task.value, nodeId, cost, extra, traceId: loopTraceId });
        } else {
            await this.finalizeTaskRun("failure", { logger: executeLogger, taskId: task.id, taskTypeKey: task.value, nodeId, cost, extra, traceId: loopTraceId });
        }
        const duration = Date.now() - startTime;
        executeLogger.info("業務邏輯執行完成", {
            topic: "task",
            context: { taskId: task.id, durationMs: duration, },
        });
    }

    /** 執行過程遇到未知錯誤以至於無法繼續執行時：DOING → OPEN（RESET），釋放已認領的任務。 */
    private async abortTaskRun(params: {
        logger: LoggerWithContext;
        taskId: string;
        nodeId: string;
        traceId: string;
        extra?: TaskRunResult["extra"];
    }): Promise<boolean> {
        const { logger, taskId, nodeId, traceId, extra } = params;
        const logContext = { taskId, nodeId };
        const extraValue = typeof extra === "string" ? extra : undefined;

        const { error } = await patchChangeTaskStatus({
            id: taskId,
            action: TaskStatusAction.RESET,
            nodeId,
            extra: extraValue,
            traceId,
        });

        if (error) {
            logger.error(error.message, {
                topic: "task",
                context: logContext,
            });
            return false;
        }
        logger.info("任務已中止並 RESET 為 OPEN", { topic: "task", context: logContext });
        return true;
    }

    /** Task 執行結束後更新 TaskStatus */
    private async finalizeTaskRun(
        outcome: "success" | "failure",
        params: {
            logger: LoggerWithContext;
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
        const logContext = { taskTypeKey, taskId, nodeId, };
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
        // TODO retry
        if (changeTaskStatusError) {
            // This should NOT happen
            const upperMessage = `${outcomePrefix}但是更新 TaskStatus 失敗，產生孤兒 Task，請儘快排查問題`;
            logger.critical(upperMessage, {
                topic: "task",
                context: logContext,
            });
            throw new Error(upperMessage);
        }
        logger.info("更新 TaskStatus 成功", { topic: "task", context: logContext });
        if (outcome === "success") {
            logger.success("任務執行結束，業務邏輯成功", { topic: "task", context: logContext });
        } else {
            logger.warn("任務執行結束，業務邏輯失敗", { topic: "task", context: logContext });
        }
    }

    /**
     * 關閉節點並退出進程。冪等：並發或重複調用復用同一進行中的 Promise，
     * 避免重複 patchStopNode / process.exit。
     */
    async shutdown(options?: { trigger?: string }): Promise<void> {
        if (this.shutdownPromise != null) {
            const { logger } = logManager.withContext({
                module: "nodeManager",
                traceId: this.startupTraceId,
                nodeId: this.getLogNodeId(),
            });
            logger.debug("shutdown 已在進行，跳過重複調用", {
                topic: "node",
                context: { trigger: options?.trigger ?? "unknown" },
            });
            return this.shutdownPromise;
        }

        this.isRunning = false;
        this.shutdownPromise = this.runShutdown(options?.trigger).catch((error) => {
            const { logger } = logManager.withContext({
                module: "nodeManager",
                traceId: this.startupTraceId,
                nodeId: this.getLogNodeId(),
            });
            logger.error("shutdown 流程異常", {
                topic: "node",
                context: {
                    trigger: options?.trigger ?? "explicit",
                    error: getErrorMessage(error),
                },
            });
            process.exit(1);
        });
        return this.shutdownPromise;
    }

    private async runShutdown(trigger?: string): Promise<void> {
        const { logger } = logManager.withContext({
            module: "nodeManager",
            traceId: this.startupTraceId,
            nodeId: this.getLogNodeId(),
        });

        logger.info("正在關閉節點進程", {
            topic: "node",
            context: { trigger: trigger ?? "explicit" },
        });

        if (this.localNodeId == null) {
            logger.info("本地節點未註冊，直接退出", { topic: "node" });
            process.exit(0);
            return;
        }

        logger.info("正在登出節點", { topic: "node", context: { nodeId: this.localNodeId } });
        try {
            const { error } = await patchStopNode({
                nodeId: this.localNodeId,
                traceId: this.startupTraceId,
            });
            if (error) {
                throw new Error(`patchStopNode 失敗: ${error.message}`);
            }
            logger.success("節點已登出", { topic: "node" });
        } catch (error) {
            logger.critical("登出節點失敗", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
        } finally {
            logger.info("節點進程退出", { topic: "node" });
            process.exit(0);
        }
    }

    /** @returns 心跳是否成功 */
    async heartbeat(ctx: NodeLoopContext): Promise<boolean> {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withContext({
            module: "heartbeat",
            traceId: loopTraceId,
            nodeId,
        });

        logger.info("開始發送心跳", { topic: "node" });
        let error: { message: string } | undefined;
        let lastHeartBeat: number | null | undefined;
        try {
            const response = await patchNodeHeartBeat({ nodeId, traceId: loopTraceId });
            error = response.error;
            lastHeartBeat = response.data;
        } catch (caught) {
            error = { message: getErrorMessage(caught) };
            lastHeartBeat = null;
        }
        if (error || lastHeartBeat == null) {
            this.consecutiveHeartbeatFailures++;
            const failureCount = this.consecutiveHeartbeatFailures;
            const logContext = {
                error: getErrorMessage(error),
                consecutiveFailures: failureCount,
                threshold: NodeManager.HEARTBEAT_FAILURE_THRESHOLD,
            };
            if (failureCount >= NodeManager.HEARTBEAT_FAILURE_THRESHOLD) {
                logger.critical("連續心跳失敗達上限，準備關閉節點", {
                    topic: "node",
                    context: logContext,
                });
                this.requestShutdown("heartbeat:consecutive-failures");
            } else {
                logger.warn("心跳更新失敗", { topic: "node", context: logContext });
            }
            return false;
        }

        this.consecutiveHeartbeatFailures = 0;
        logger.success("心跳更新成功", {
            topic: "node",
            context: { lastHeartBeat: formatHeartbeat(lastHeartBeat) },
        });
        return true;
    }

    async batchCommand(ctx: NodeLoopContext) {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withContext({
            module: "batchCommand",
            traceId: loopTraceId,
            nodeId,
        });

        logger.debug("開始檢查控制指令", { topic: "node" });

        const { data: commandList = [], error: pollError } = await getPollCommandList({
            nodeId,
            traceId: loopTraceId,
            size: MAX_POLL_TARGET_LIST_SIZE,
        });
        if (pollError) {
            logger.warn("獲取指令失敗", {
                topic: "node",
                context: { error: pollError.message }
            });
            return;
        }
        if (commandList.length === 0) {
            logger.info("獲取指令數量為 0", {
                topic: "node",
            });
            return;
        }

        logger.info("獲取到控制指令", {
            topic: "node",
            context: { count: commandList.length },
        });

        for (const command of commandList) {
            const cmd = command.name;
            logger.info("執行控制指令", {
                topic: "node",
                context: { commandId: command.id, cmd },
            });
            try {
                await this.executeCommand(cmd);
                logger.success("控制指令執行成功", {
                    topic: "node",
                    context: { commandId: command.id, cmd },
                });
            } catch (error) {
                logger.warn("控制指令執行失敗", {
                    topic: "node",
                    context: {
                        commandId: command.id,
                        cmd,
                        error: getErrorMessage(error),
                    },
                });
            }
        }

        logger.info("控制指令批次處理完成", {
            topic: "node",
            context: { totalDequeued: commandList.length },
        });
    }

    async executeCommand(cmd: CommandType) {
        switch (cmd) {
            case CommandType.STOP_NODE:
                this.requestShutdown("cmd:STOP_NODE");
                return;
            default: {
                const unknownCmd: never = cmd;
                throw new Error(`無法解析的cmd: ${unknownCmd}`);
            }
        }
    }
}