import logManager, { type LoggerWithContext } from "../shared/log/log-manager";
import { getErrorMessage, toError } from "../shared/utils/error.utils";
import TaskManager, { TaskRunResult } from "../task/task-manager";
import { patchChangeTaskStatus, patchClaimTask } from "../task/task.api";
import { Task, TaskStatusAction } from "../task/task.interface";
import { patchChangeNodeStatus, patchNodeHeartBeat, patchStopNode, postRegisterNode } from "./node.api";
import { NodeLoopContext, NodeStatus } from "./node.interface";
import { formatHeartbeat, getRandomInterval } from "./node.utils";

export class NodeManager {
    private _localNodeId: string | null = null;
    private _isNodeIdLocked: boolean = false;
    private _availableTaskList: string[] = [];

    private isRunning: boolean;
    private loopCount: number;
    /** 进程生命周期 traceId — bootstrap / register / shutdown 共用 */
    private readonly startupTraceId: string;

    get availableTaskList(): string[] {
        return this._availableTaskList;
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

    /** 启动日志 + SIGTERM/SIGINT/uncaughtException/unhandledRejection → shutdown */
    private registerProcessLifecycle(logger: LoggerWithContext): void {
        process.on("SIGTERM", async () => {
            logger.warn("收到 SIGTERM 信号，准备关闭节点", { topic: "process" });
            await this.shutdown();
        });
        process.on("SIGINT", async () => {
            logger.warn("收到 SIGINT 信号，准备关闭节点", { topic: "process" });
            await this.shutdown();
        });
        process.on("uncaughtException", async (error) => {
            logger.error("未捕获的异常，准备关闭节点", {
                topic: "process",
                context: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });
            await this.shutdown();
        });
        process.on("unhandledRejection", async (reason) => {
            logger.error("未处理的 Promise 拒绝，准备关闭节点", {
                topic: "process",
                context: {
                    reason: getErrorMessage(reason),
                    stack: reason instanceof Error ? reason.stack : undefined,
                },
            });
            await this.shutdown();
        });
    }

    async start() {
        const { logger } = logManager.withContext({
            module: "nodeManager",
            traceId: this.startupTraceId,
            nodeId: this.getLogNodeId(),
        });

        logger.info("节点进程启动中", {
            topic: "node",
            context: {
                pid: process.pid,
                env: process.env.NODE_ENV ?? "development",
            },
        });
        this.registerProcessLifecycle(logger);

        logger.info("开始扫描并注册本地任务", { topic: "node" });
        try {
            this._availableTaskList = await TaskManager.runWorkerLocalTaskBootstrap(this._availableTaskList);
            logger.success("本地任务注册流程完成", {
                topic: "node",
                context: { availableTaskList: this._availableTaskList },
            });
        } catch (error) {
            logger.error("本地任务注册失败", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
            await this.shutdown();
        }

        logger.info("开始向 Supabase 注册节点", { topic: "node" });
        try {
            const { data, error } = await postRegisterNode({ traceId: this.startupTraceId });
            if (data == null || error) {
                throw error ?? new Error("postRegisterNode 失败");
            }
            this.localNodeId = data.id;
            logger.resetContext({ nodeId: data.id });
            logger.success("节点注册成功", {
                topic: "node",
                context: {
                    nodeId: data.id,
                    details: data.details,
                },
            });
        } catch (error) {
            logger.error("节点注册失败", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
            await this.shutdown();
        }

        const nodeId = this.localNodeId!;
        logger.info("节点进入主循环", { topic: "node" });
        while (this.isRunning) {
            this.loopCount++;
            const loopTraceId = logManager.generateTraceId();
            const loopCtx: NodeLoopContext = { loopTraceId, nodeId };
            const { logger: iterLogger } = logManager.withContext({
                module: "nodeManager",
                traceId: loopTraceId,
                nodeId,
            });

            iterLogger.info(`主循环第 ${this.loopCount} 轮开始`, {
                topic: "node",
                context: { loopCount: this.loopCount },
            });
            try {
                // 每轮三步：1. 控制指令  2. 心跳  3. 认领并执行任务
                await this.batchCommand(loopCtx);
                await this.heartbeat(loopCtx);
                await this.runAsWorker(loopCtx);
            } catch (error) {
                iterLogger.error("主循环第 ${this.loopCount} 轮失败", {
                    topic: "node",
                    context: { error: getErrorMessage(error) },
                });
            }
            const interval = getRandomInterval();
            iterLogger.debug(`主循环第 ${this.loopCount} 轮完成，等待下一轮`, {
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
        logger.debug("开始尝试认领以下任务类型", {
            topic: "node",
            context: {
                capabilityCount: availableTaskList.length,
                availableTaskList,
            },
        });
        if (availableTaskList.length === 0) {
            logger.debug("未配置可认领任务类型，跳过本轮", { topic: "node" });
            return;
        }

        logger.info("向 Supabase 认领任务", {
            topic: "node",
            context: { availableTaskList },
        });
        const { data: task, error: claimError } = await patchClaimTask({
            nodeId,
            availableTaskList,
            traceId: loopTraceId,
        });

        if (claimError) {
            logger.error("认领任务 API 失败", {
                topic: "node",
                context: {
                    availableTaskList,
                    error: claimError.message,
                },
            });
            return;
        }
        if (task == null) {
            logger.debug("本轮无匹配的 TODO 任务", {
                topic: "node",
                context: { availableTaskList },
            });
            return;
        }

        logger.info("认领任务成功，准备执行", {
            topic: "node",
            context: {
                taskId: task.id,
                taskName: task.name,
                taskTypeKey: task.value,
                taskStatus: task.details.status,
                repoKey: task.details.repo?.value ?? null,
            },
        });
        try {
            const { logger: prepareLogger } = logManager.withContext({
                module: "prepareTask",
                traceId: loopTraceId,
                nodeId,
            });
            const { isSuccess, taskFn } = await TaskManager.prepareTask({ logger: prepareLogger, task });
            if (!isSuccess || taskFn == null) {
                prepareLogger.error("任务准备失败，无法执行", {
                    topic: "node",
                    context: {
                        task
                    },
                });
                throw new Error("[prepareTask]任务准备失败，无法执行");
            }

            const { logger: executeLogger } = logManager.withContext({
                module: "executeTask",
                traceId: loopTraceId,
                nodeId,
            });
            executeLogger.info("开始执行业务逻辑", {
                topic: "task",
                context: { taskId: task.id, displayName: taskFn.displayName },
            });
            const startTime = Date.now();
            const { isSuccess: taskSuccess, cost, extra } = await taskFn();
            if (taskSuccess) {
                await this.finalizeTaskRun("success", { logger: executeLogger, taskId: task.id, nodeId, cost, extra, traceId: loopTraceId });
            } else {
                await this.finalizeTaskRun("failure", { logger: executeLogger, taskId: task.id, nodeId, cost, extra, traceId: loopTraceId });
            }
            const duration = Date.now() - startTime;
            executeLogger.success("业务逻辑执行完成", {
                topic: "task",
                context: { taskId: task.id, durationMs: duration, },
            });
        } catch (error) {
            logger.error("任务执行失败", {
                topic: "node",
                context: {
                    taskId: task.id,
                    taskName: task.name,
                    taskTypeKey: task.value,
                    error: getErrorMessage(error),
                },
            });
        }
        logger.success("Worker轮次任务执行完成", {
            topic: "node",
            context: { taskId: task.id, taskTypeKey: task.value },
        });
    }

    /** Task 执行结束后统一收尾：更新 TaskStatus + NodeStatus */
    private async finalizeTaskRun(
        outcome: "success" | "failure",
        params: {
            logger: LoggerWithContext;
            taskId: string;
            nodeId: string;
            cost: TaskRunResult["cost"];
            extra: TaskRunResult["extra"];
            traceId: string;
        }
    ): Promise<void> {
        const { logger, taskId, nodeId, cost, extra, traceId } = params;
        const outcomePrefix = outcome === "success" ? "任務成功" : "任務失败";
        const logContext = { taskId, nodeId };
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
            logger.error(changeTaskStatusError.message, {
                topic: "task",
                context: logContext,
            });
            throw new Error(`${outcomePrefix}但是更新TaskStatus失敗`);
        }
        logger.info("更新TaskStatus成功", { topic: "task", context: logContext });

        // TODO 事务
        const { error: changeNodeStatusError } = await patchChangeNodeStatus({
            nodeId,
            status: NodeStatus.READY,
            fromStatus: NodeStatus.BUSY,
            traceId,
        });
        if (changeNodeStatusError) {
            logger.error(changeNodeStatusError.message, {
                topic: "node",
                context: logContext,
            });
            throw new Error(`${outcomePrefix}但是更新NodeStatus失敗`);
        }
        logger.info("更新NodeStatus成功", { topic: "node", context: logContext });
    }

    async shutdown() {
        const { logger } = logManager.withContext({
            module: "nodeManager",
            traceId: this.startupTraceId,
            nodeId: this.getLogNodeId(),
        });

        logger.info("正在关闭节点进程", { topic: "node" });

        if (this.localNodeId == null) {
            logger.info("本地节点未注册，直接退出", { topic: "node" });
            process.exit(0);
        } else {
            this.isRunning = false;
            logger.info("正在登出节点", { topic: "node", context: { nodeId: this.localNodeId } });
            try {
                const { error } = await patchStopNode({
                    nodeId: this.localNodeId,
                    traceId: this.startupTraceId,
                });
                if (error) {
                    throw new Error(`patchStopNode 失败: ${error.message}`);
                }
                logger.success("节点已登出", { topic: "node" });
            } catch (error) {
                logger.error("登出节点失败", {
                    topic: "node",
                    context: { error: getErrorMessage(error) },
                });
            } finally {
                logger.info("节点进程退出", { topic: "node" });
                process.exit(0);
            }
        }
    }

    async heartbeat(ctx: NodeLoopContext) {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withContext({
            module: "heartbeat",
            traceId: loopTraceId,
            nodeId,
        });

        logger.info("开始发送心跳", { topic: "node" });
        const { error, data: lastHeartBeat } = await patchNodeHeartBeat({ nodeId, traceId: loopTraceId });
        if (error || lastHeartBeat == null) {
            // TODO should not happen this critical error 
            logger.error("心跳更新失败", {
                topic: "node",
                context: { error: getErrorMessage(error) },
            });
            throw error ?? new Error("patchNodeHeartBeat Failed");
        }
        logger.success("心跳更新成功", {
            topic: "node",
            context: { lastHeartBeat: formatHeartbeat(lastHeartBeat) },
        });
    }

    async batchCommand(ctx: NodeLoopContext) {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withContext({
            module: "batchCommand",
            traceId: loopTraceId,
            nodeId,
        });

        logger.debug("开始检查控制指令", { topic: "node" });
        // try {
        //     const { data: commandList, error: commandError } = await supabase
        //         .from("target")
        //         .select("*")
        //         .eq("category", "command")
        //         .eq("details->>toNodeId", nodeId)
        //         .order("created_at", { ascending: true });
        //     if (commandError) {
        //         throw new Error(`获取指令失败: ${commandError.message}`);
        //     }
        //     if (commandList?.length > 0) {
        //         logger.info("获取到控制指令", { topic: "node", context: { count: commandList.length } });
        //         const allCommandList = commandList as Command[];
        //         const todoCommandList: Command[] = [];
        //         for (const command of allCommandList) {
        //             try {
        //                 const { error: deleteError } = await supabase.from("target").delete().eq("id", command.id);
        //                 if (deleteError) {
        //                     logger.warn("删除指令失败", { topic: "node", context: { commandId: command.id, error: deleteError.message } });
        //                 } else {
        //                     todoCommandList.push(command);
        //                 }
        //             } catch (error) { }
        //         }
        //         for (const command of todoCommandList) {
        //             const cmd = command?.details?.cmd;
        //             if (cmd != null && cmd !== "") {
        //                 logger.info("执行控制指令", { topic: "node", context: { cmd } });
        //                 try {
        //                     await this.executeCommand(cmd);
        //                     logger.success("控制指令执行成功", { topic: "node", context: { cmd } });
        //                 } catch (error) {
        //                     logger.error("控制指令执行失败", {
        //                         topic: "node",
        //                         context: { cmd, error: error instanceof Error ? error.message : error },
        //                     });
        //                 }
        //             }
        //         }
        //     }
        // } catch (error) {
        //     logger.error("检查控制指令失败", {
        //         topic: "node",
        //         context: { error: error instanceof Error ? error.message : error },
        //     });
        // }
    }

    async executeCommand(cmd: string) {
        if (cmd === "stop") {
            await this.shutdown();
            return;
        }
        throw new Error(`无法解析的cmd: ${cmd}`);
    }
}