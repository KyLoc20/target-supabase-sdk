import logManager from "../shared/log/log-manager";
import TaskManager, { TaskRunResult } from "../task/task-manager";
import { patchChangeTaskStatus, patchClaimTask } from "../task/task.api";
import { Task, TaskStatus, TaskStatusAction } from "../task/task.interface";
import { patchNodeHeartBeat, patchStopNode, postRegisterNode } from "./node.api";
import { NodeLoopContext } from "./node.interface";
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

    async start() {
        let { logger } = logManager.withContext({
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
                    reason: reason instanceof Error ? reason.message : reason,
                    stack: reason instanceof Error ? reason.stack : undefined,
                },
            });
            await this.shutdown();
        });

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
                context: { error: error instanceof Error ? error.message : error },
            });
            await this.shutdown();
            return;
        }

        logger.info("开始向 Supabase 注册节点", { topic: "node" });
        try {
            const { data, error } = await postRegisterNode({});
            if (data == null) {
                throw new Error("postRegisterNode 返回空数据");
            }
            if (error) {
                throw new Error(`postRegisterNode 失败: ${error.message}`);
            }

            this.localNodeId = data.id;
            ({ logger } = logManager.withContext({
                module: "nodeManager",
                traceId: this.startupTraceId,
                nodeId: data.id,
            }));
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
                context: { error: error instanceof Error ? error.message : error },
            });
            await this.shutdown();
            return;
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

            // 每轮三步：1. 控制指令  2. 心跳  3. 认领并执行任务
            await this.batchCommand(loopCtx);
            await this.heartbeat(loopCtx);
            await this.runAsWorker(loopCtx);
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
        logger.debug("Worker 开始尝试认领任务", {
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
            await this.executeTask({ task, ...ctx });
            logger.success("Worker 轮次任务执行完成", {
                topic: "node",
                context: { taskId: task.id, taskTypeKey: task.value },
            });
        } catch (error) {
            logger.error("任务执行失败", {
                topic: "node",
                context: {
                    taskId: task.id,
                    taskName: task.name,
                    taskTypeKey: task.value,
                    error: error instanceof Error ? error.message : error,
                },
            });
        }
    }

    async executeTask(params: { task: Task } & NodeLoopContext) {
        const { task, loopTraceId, nodeId } = params;
        const { logger: prepareLogger } = logManager.withContext({
            module: "prepareTask",
            traceId: loopTraceId,
            nodeId,
        });
        const { isSuccess, taskFn } = await TaskManager.prepareTask({ logger: prepareLogger, task });
        if (!isSuccess || taskFn == null) {
            throw new Error("[executeTask] 任务准备失败，无法执行");
        }

        const { logger } = logManager.withContext({
            module: "executeTask",
            traceId: loopTraceId,
            nodeId,
        });

        logger.info("开始执行业务逻辑", {
            topic: "task",
            context: { taskId: task.id, displayName: taskFn.displayName },
        });
        const startTime = Date.now();
        const { isSuccess: taskSuccess, cost, extra } = await taskFn();
        if (taskSuccess) {
            await this.onTaskSuccess({ taskId: task.id, nodeId, cost, extra, traceId: loopTraceId });
        } else {
            await this.onTaskFailed({ taskId: task.id, nodeId, cost, extra, traceId: loopTraceId });
        }
        const duration = Date.now() - startTime;
        logger.success("业务逻辑执行完成", {
            topic: "task",
            context: { taskId: task.id, durationMs: duration, },
        });
    }

    async onTaskSuccess(params: {
        taskId: string;
        nodeId: string;
        cost: TaskRunResult["cost"];
        extra: TaskRunResult["extra"];
        traceId: string;
    }) {
        // const { taskId, nodeId, cost, extra, traceId } = params;
        // // DOING -> DONE
        // if (nextTaskStatus === TaskStatus.DONE) {
        //     try {
        //         await patchChangeTaskStatus({
        //             id: taskId,
        //             action: TaskStatusAction.FINISH,
        //             extra,
        //             nodeId,
        //             cost,
        //             traceId,
        //         });
        //     } catch (error) {
        //         throw new Error("[onTaskSuccess] 任务成功但是更新TaskStatus失败:", error);
        //     }
        //     try {
        //         await updateTargetDetails<Node, NodeDetails>({
        //             id: nodeId,
        //             updateFn: (details) => {
        //                 return {
        //                     ...details,
        //                     lastHeartBeat: Date.now(),
        //                     nodeStatus: NodeStatus.READY,
        //                 };
        //             },
        //         });
        //     } catch (error) {
        //         throw new Error("[onTaskSuccess] 任务成功但是更新NodeStatus失败:", error);
        //     }
        // } else {
        //     // TODO
        // }
    }

    async onTaskFailed(params: {
        taskId: string;
        nodeId: string;
        cost: TaskRunResult["cost"];
        extra: TaskRunResult["extra"];
        traceId: string;
    }) {
        // const { taskId, nodeId, extra, traceId } = params;
        // // DOING -> OPEN
        // try {
        //     await patchChangeTaskStatus({
        //         id: taskId,
        //         action: TaskStatusAction.RESET,
        //         extra,
        //         nodeId,
        //         traceId,
        //     });
        // } catch (error) {
        //     throw new Error("[onTaskFailed] 任务失败且更新TaskStatus失败:", error);
        // }
        // try {
        //     await updateTargetDetails<Node, NodeDetails>({
        //         id: nodeId,
        //         updateFn: (details) => {
        //             return {
        //                 ...details,
        //                 lastHeartBeat: Date.now(),
        //                 nodeStatus: NodeStatus.READY,
        //             };
        //         },
        //     });
        // } catch (error) {
        //     throw new Error("[onTaskFailed] 任务失败且更新NodeStatus失败:", error);
        // }
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
                const { error } = await patchStopNode({ nodeId: this.localNodeId });
                if (error) {
                    throw new Error(`patchStopNode 失败: ${error.message}`);
                }
                logger.success("节点已登出", { topic: "node" });
            } catch (error) {
                logger.error("登出节点失败", {
                    topic: "node",
                    context: { error: error instanceof Error ? error.message : error },
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
        try {
            const { error, data: lastHeartBeat } = await patchNodeHeartBeat({ nodeId });
            if (error || lastHeartBeat == null) {
                throw error ?? new Error("patchNodeHeartBeat 返回空数据");
            }
            logger.success("心跳更新成功", {
                topic: "node",
                context: { lastHeartBeat: formatHeartbeat(lastHeartBeat) },
            });
        } catch (error) {
            logger.error("心跳更新失败", {
                topic: "node",
                context: { error: error instanceof Error ? error.message : error },
            });
            await this.shutdown();
        }
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