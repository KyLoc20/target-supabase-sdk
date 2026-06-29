import { MAX_POLL_TARGET_LIST_SIZE } from "../core.api";
import { getPollCommandList } from "../command/command.api";
import { CommandType } from "../command/command.interface";
import {
    applyScopePatch,
    createChildScope,
    createRootScope,
    logManager,
    scopeForLoop,
    type LoggerWithScope,
    type LogScope,
} from "../shared/log";
import { getErrorMessage } from "../shared/utils/error.utils";
import { patchChangeNodeStatus, patchNodeHeartBeat, patchStopNode, postRegisterNode } from "./node.api";
import { NodeLoopContext, NodeStatus } from "./node.interface";
import { formatHeartbeat, getRandomInterval } from "./node.utils";

/**
 * Shared node process runtime: bootstrap, main-loop frame, heartbeat, commands, shutdown.
 * Subclasses implement {@link onBeforeRegisterNode} and {@link runLoopSteps}.
 */
abstract class BaseNodeRuntime {
    protected static readonly HEARTBEAT_FAILURE_THRESHOLD = 3;

    protected readonly runtimeModule: string;

    private _localNodeId: string | null = null;
    private _isNodeIdLocked = false;

    private isRunning: boolean;
    private loopCount: number;
    private consecutiveHeartbeatFailures = 0;
    private readonly startupTraceId: string;
    private readonly startupScope: LogScope;
    private shutdownPromise: Promise<void> | null = null;
    private startPromise: Promise<void> | null = null;

    get localNodeId(): string | null {
        return this._localNodeId;
    }

    protected set localNodeId(value: string) {
        if (this._isNodeIdLocked) {
            throw new Error("Node ID cannot be modified after initial assignment");
        }
        if (typeof value !== "string" || value.trim() === "") {
            throw new Error("Invalid node ID");
        }

        this._localNodeId = value;
        this._isNodeIdLocked = true;
    }

    protected constructor(runtimeModule: string) {
        this.runtimeModule = runtimeModule;
        this.isRunning = true;
        this.loopCount = 0;
        this.startupTraceId = logManager.generateTraceId();
        this.startupScope = createRootScope(runtimeModule, this.startupTraceId);
    }

    /** Hook: task registration, trigger config load, etc. Throw to abort bootstrap. */
    protected abstract onBeforeRegisterNode(logger: LoggerWithScope): Promise<void>;

    /** Hook: one iteration body after commands + heartbeat gate. */
    protected abstract runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void>;

    private getLogNodeId(): string {
        return this.localNodeId ?? "bootstrap";
    }

    protected isShuttingDown(): boolean {
        return this.shutdownPromise != null;
    }

    protected requestShutdown(trigger: string): void {
        void this.shutdown({ trigger });
    }

    private registerProcessLifecycle(logger: LoggerWithScope): void {
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
                    data: {
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
                data: {
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
                    data: {
                        reason: getErrorMessage(reason),
                        stack: reason instanceof Error ? reason.stack : undefined,
                    },
                });
                return;
            }
            logger.error("未處理的 Promise 拒絕，準備關閉節點", {
                topic: "process",
                data: {
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
        const { logger } = logManager.withScope(
            applyScopePatch(this.startupScope, { labels: { nodeId: this.getLogNodeId() } })
        );

        logger.info("節點進程啟動中", {
            topic: "node",
            data: {
                pid: process.pid,
                env: process.env.NODE_ENV ?? "development",
                runtime: this.runtimeModule,
            },
        });
        this.registerProcessLifecycle(logger);

        try {
            await this.onBeforeRegisterNode(logger);
        } catch (error) {
            logger.error("節點啟動前置步驟失敗", {
                topic: "node",
                data: { error: getErrorMessage(error) },
            });
            this.requestShutdown("bootstrap:pre-register");
            return;
        }

        logger.info("開始向 Supabase 註冊節點", { topic: "node" });
        try {
            const { data, error } = await postRegisterNode({ traceId: this.startupTraceId });
            if (data == null || error) {
                throw error ?? new Error("postRegisterNode 失敗");
            }
            this.localNodeId = data.id;
            logger.resetScope({ labels: { nodeId: data.id } });
            logger.success("節點註冊成功", {
                topic: "node",
                data: {
                    nodeId: data.id,
                    details: data.details,
                },
            });
        } catch (error) {
            logger.error("節點註冊失敗", {
                topic: "node",
                data: { error: getErrorMessage(error) },
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
                data: { error: enterBusyError.message },
            });
            this.requestShutdown("bootstrap:enter-busy");
            return;
        }
        logger.info("節點狀態已設為 BUSY，進入主循環", { topic: "node", data: { nodeId } });

        while (this.isRunning) {
            this.loopCount++;
            const loopTraceId = logManager.generateTraceId();
            const loopScope = createChildScope(
                `${this.runtimeModule}-loop-iteration`,
                applyScopePatch(this.startupScope, { labels: { nodeId } }),
                { traceId: loopTraceId }
            );
            const loopCtx: NodeLoopContext = { loopTraceId, nodeId };
            const { logger: iterLogger } = logManager.withScope(loopScope);

            iterLogger.info(`主循環第 ${this.loopCount} 輪開始`, {
                topic: "node",
                data: { nodeId, loopCount: this.loopCount },
            });
            try {
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
                await this.runLoopSteps(loopCtx, heartbeatOk);
            } catch (error) {
                iterLogger.critical(`主循環第 ${this.loopCount} 輪遇到未知錯誤`, {
                    topic: "node",
                    data: { error: getErrorMessage(error) },
                });
            }
            if (this.isShuttingDown()) {
                iterLogger.debug("節點關閉中，跳過等待間隔", { topic: "node" });
                break;
            }
            const interval = getRandomInterval();
            iterLogger.debug(`主循環第 ${this.loopCount} 輪完成，等待下一輪`, {
                topic: "node",
                data: { intervalMs: interval },
            });
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }

    async shutdown(options?: { trigger?: string }): Promise<void> {
        if (this.shutdownPromise != null) {
            const { logger } = logManager.withScope(
                applyScopePatch(this.startupScope, { labels: { nodeId: this.getLogNodeId() } })
            );
            logger.debug("shutdown 已在進行，跳過重複調用", {
                topic: "node",
                data: { trigger: options?.trigger ?? "unknown" },
            });
            return this.shutdownPromise;
        }

        this.isRunning = false;
        this.shutdownPromise = this.runShutdown(options?.trigger).catch((error) => {
            const { logger } = logManager.withScope(
                applyScopePatch(this.startupScope, { labels: { nodeId: this.getLogNodeId() } })
            );
            logger.error("shutdown 流程異常", {
                topic: "node",
                data: {
                    trigger: options?.trigger ?? "explicit",
                    error: getErrorMessage(error),
                },
            });
            process.exit(1);
        });
        return this.shutdownPromise;
    }

    private async runShutdown(trigger?: string): Promise<void> {
        const { logger } = logManager.withScope(
            applyScopePatch(this.startupScope, { labels: { nodeId: this.getLogNodeId() } })
        );

        logger.info("正在關閉節點進程", {
            topic: "node",
            data: { trigger: trigger ?? "explicit" },
        });

        if (this.localNodeId == null) {
            logger.info("本地節點未註冊，直接退出", { topic: "node" });
            process.exit(0);
            return;
        }

        logger.info("正在登出節點", { topic: "node", data: { nodeId: this.localNodeId } });
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
                data: { error: getErrorMessage(error) },
            });
        } finally {
            logger.info("節點進程退出", { topic: "node" });
            process.exit(0);
        }
    }

    async heartbeat(ctx: NodeLoopContext): Promise<boolean> {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withScope(
            scopeForLoop("heartbeat", loopTraceId, nodeId, this.startupTraceId)
        );

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
            const logData = {
                error: getErrorMessage(error),
                consecutiveFailures: failureCount,
                threshold: BaseNodeRuntime.HEARTBEAT_FAILURE_THRESHOLD,
            };
            if (failureCount >= BaseNodeRuntime.HEARTBEAT_FAILURE_THRESHOLD) {
                logger.critical("連續心跳失敗達上限，準備關閉節點", {
                    topic: "node",
                    data: logData,
                });
                this.requestShutdown("heartbeat:consecutive-failures");
            } else {
                logger.warn("心跳更新失敗", { topic: "node", data: logData });
            }
            return false;
        }

        this.consecutiveHeartbeatFailures = 0;
        logger.success("心跳更新成功", {
            topic: "node",
            data: { lastHeartBeat: formatHeartbeat(lastHeartBeat) },
        });
        return true;
    }

    async batchCommand(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId, nodeId } = ctx;
        const { logger } = logManager.withScope(
            scopeForLoop("batchCommand", loopTraceId, nodeId, this.startupTraceId)
        );

        logger.debug("開始檢查控制指令", { topic: "node" });

        const { data: commandList = [], error: pollError } = await getPollCommandList({
            nodeId,
            traceId: loopTraceId,
            size: MAX_POLL_TARGET_LIST_SIZE,
        });
        if (pollError) {
            logger.warn("獲取指令失敗", {
                topic: "node",
                data: { error: pollError.message },
            });
            return;
        }
        if (commandList.length === 0) {
            logger.info("獲取指令數量為 0", { topic: "node" });
            return;
        }

        logger.info("獲取到控制指令", {
            topic: "node",
            data: { count: commandList.length },
        });

        for (const command of commandList) {
            const cmd = command.name;
            logger.info("執行控制指令", {
                topic: "node",
                data: { commandId: command.id, cmd },
            });
            try {
                await this.executeCommand(cmd);
                logger.success("控制指令執行成功", {
                    topic: "node",
                    data: { commandId: command.id, cmd },
                });
            } catch (error) {
                logger.warn("控制指令執行失敗", {
                    topic: "node",
                    data: {
                        commandId: command.id,
                        cmd,
                        error: getErrorMessage(error),
                    },
                });
            }
        }

        logger.info("控制指令批次處理完成", {
            topic: "node",
            data: { totalDequeued: commandList.length },
        });
    }

    async executeCommand(cmd: CommandType): Promise<void> {
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

export { BaseNodeRuntime };
