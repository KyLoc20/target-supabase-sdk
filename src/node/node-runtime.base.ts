import { getPollCommandList } from "../command/command.api";
import { CommandType } from "../command/command.interface";
import { MAX_POLL_TARGET_LIST_SIZE } from "../core.api";
import {
    createLogger,
    createScope,
    type LoggerWithScope,
    LogLevel,
    type LogScope,
    logManager,
    patchScope,
} from "../shared/log";
import { getErrorMessage } from "../shared/utils/error.utils";
import { patchChangeNodeStatus, patchNodeHeartBeat, patchStopNode, postRegisterNode } from "./node.api";
import { NodeStatus } from "./node.interface";
import { formatHeartbeat, getRandomInterval } from "./node.utils";

/** 主循环单轮运行时上下文 — 由 start() 创建并向下传递 */
export interface NodeLoopContext {
    loopTraceId: string;
    nodeId: string;
}

/** Shared options for {@link BaseNodeRuntime} and subclasses (e.g. TriggerNode). */
export interface BaseNodeRuntimeOptions {
    /**
     * Called after node logout (or when the node was never registered),
     * immediately before `process.exit`. Use for best-effort cleanup such as
     * {@link unregisterServiceAtShutdown}. Errors are logged and ignored.
     */
    beforeProcessExit?: () => void | Promise<void>;
}

export const LOG_TOPIC_NODE = "node";
const LOG_TOPIC_COMMAND = "command";
const LOG_TOPIC_PROCESS = "process";

/**
 * Shared node process runtime: bootstrap, main-loop frame, heartbeat, commands, shutdown.
 * Subclasses implement {@link onBeforeRegisterNode} and {@link runLoopSteps}.
 */
abstract class BaseNodeRuntime {
    protected static readonly HEARTBEAT_FAILURE_THRESHOLD = 3;
    /** Log `nodeId` label while startup has not yet received an assigned id from Supabase. */
    private static readonly NODE_ID_PENDING_ASSIGNMENT = "pending-node-id";

    protected readonly runtimeModule: string;
    private readonly beforeProcessExitHook: (() => void | Promise<void>) | null;

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

    protected constructor(runtimeModule: string, options?: BaseNodeRuntimeOptions) {
        this.runtimeModule = runtimeModule;
        this.beforeProcessExitHook = options?.beforeProcessExit ?? null;
        this.isRunning = false;
        this.loopCount = 0;
        this.startupTraceId = logManager.generateTraceId();
        this.startupScope = createScope({ module: runtimeModule, traceId: this.startupTraceId });
    }

    private async runBeforeProcessExit(logger: LoggerWithScope): Promise<void> {
        if (this.beforeProcessExitHook == null) {
            return;
        }
        try {
            await this.beforeProcessExitHook();
        } catch (error) {
            logger.warn("beforeProcessExit 钩子失败（best-effort）", {
                topic: LOG_TOPIC_PROCESS,
                data: { error: getErrorMessage(error) },
            });
        }
    }

    private async exitProcess(code: number, logger: LoggerWithScope): Promise<never> {
        await this.runBeforeProcessExit(logger);
        process.exit(code);
    }

    /** Hook: task registration, trigger config load, etc. Throw to abort bootstrap. */
    protected abstract onBeforeRegisterNode(logger: LoggerWithScope): Promise<void>;

    /** Hook: one iteration body after commands + heartbeat gate. */
    protected abstract runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void>;

    /** Hook: minimum log level for main-loop scoped loggers (heartbeat, batchCommand, iteration). */
    protected loopLoggerMinLevel(): LogLevel {
        return LogLevel.INFO;
    }

    /** Hook: ms to wait between loop iterations. Default: random 15–60s. */
    protected getLoopIntervalMs(): number {
        return getRandomInterval();
    }

    private getLogNodeId(): string {
        return this.localNodeId ?? BaseNodeRuntime.NODE_ID_PENDING_ASSIGNMENT;
    }

    protected isShuttingDown(): boolean {
        return this.shutdownPromise != null;
    }

    protected requestShutdown(trigger: string): void {
        void this.shutdown({ trigger });
    }

    private registerProcessLifecycle(logger: LoggerWithScope): void {
        process.on("SIGTERM", () => {
            logger.warn("收到 SIGTERM 信號，準備關閉節點", { topic: LOG_TOPIC_PROCESS });
            this.requestShutdown("SIGTERM");
        });
        process.on("SIGINT", () => {
            logger.warn("收到 SIGINT 信號，準備關閉節點", { topic: LOG_TOPIC_PROCESS });
            this.requestShutdown("SIGINT");
        });
        process.on("uncaughtException", (error) => {
            if (this.shutdownPromise != null) {
                logger.critical("shutdown 進行中發生未捕獲異常，立即關閉節點", {
                    topic: LOG_TOPIC_PROCESS,
                    data: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    },
                });
                process.exit(1);
                return;
            }
            logger.critical("未捕獲的異常，準備關閉節點", {
                topic: LOG_TOPIC_PROCESS,
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
                    topic: LOG_TOPIC_PROCESS,
                    data: {
                        reason: getErrorMessage(reason),
                        stack: reason instanceof Error ? reason.stack : undefined,
                    },
                });
                return;
            }
            logger.error("未處理的 Promise 拒絕，準備關閉節點", {
                topic: LOG_TOPIC_PROCESS,
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
        const logger = createLogger({
            scope: patchScope({ scope: this.startupScope, patch: { labels: { nodeId: this.getLogNodeId() } } }),
        });

        logger.debug("節點進程啟動中", {
            topic: LOG_TOPIC_NODE,
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
                topic: LOG_TOPIC_NODE,
                data: { error: getErrorMessage(error) },
            });
            this.requestShutdown("bootstrap:pre-register");
            return;
        }

        logger.debug("開始向 Supabase 註冊節點", { topic: LOG_TOPIC_NODE });
        try {
            const { data, error } = await postRegisterNode({ traceId: this.startupTraceId });
            if (data == null || error) {
                throw error ?? new Error("postRegisterNode 失敗");
            }
            this.localNodeId = data.id;
            logger.resetScope({ labels: { nodeId: data.id } });
            logger.success("節點註冊成功", {
                topic: LOG_TOPIC_NODE,
                data: {
                    nodeId: data.id,
                    details: data.details,
                },
            });
        } catch (error) {
            logger.error("節點註冊失敗", {
                topic: LOG_TOPIC_NODE,
                data: { error: getErrorMessage(error) },
            });
            this.requestShutdown("bootstrap:register-node");
            return;
        }

        const nodeId = this.localNodeId!;
        logger.debug("節點準備進入主循環", { topic: LOG_TOPIC_NODE });
        const { error: enterBusyError } = await patchChangeNodeStatus({
            nodeId,
            status: NodeStatus.BUSY,
            fromStatus: NodeStatus.READY,
            traceId: this.startupTraceId,
        });
        if (enterBusyError) {
            logger.error("節點進入主循環失敗，無法更新節點狀態為 BUSY", {
                topic: LOG_TOPIC_NODE,
                data: { error: enterBusyError.message },
            });
            this.requestShutdown("bootstrap:enter-busy");
            return;
        }
        logger.debug("節點狀態已設為 BUSY 進入主循環", { topic: LOG_TOPIC_NODE, data: { nodeId } });
        await this.runLoop(nodeId);
    }

    private async runLoop(nodeId: string): Promise<void> {
        this.isRunning = true;

        while (this.isRunning) {
            this.loopCount++;
            const loopTraceId = logManager.generateTraceId();
            const loopScope = createScope({
                module: `${this.runtimeModule}-loop-iteration`,
                traceId: loopTraceId,
                labels: { nodeId },
            });
            const loopCtx: NodeLoopContext = { loopTraceId, nodeId };
            const iterLogger = createLogger({
                scope: loopScope,
                minLevel: this.loopLoggerMinLevel(),
            });

            iterLogger.debug(`主循環第 ${this.loopCount} 輪開始`, {
                topic: LOG_TOPIC_NODE,
                data: { nodeId, loopCount: this.loopCount },
            });
            try {
                await this.batchCommand(loopCtx);
                if (this.isShuttingDown()) {
                    iterLogger.debug("節點關閉中，跳過本輪剩餘步驟", { topic: LOG_TOPIC_NODE });
                    break;
                }
                const heartbeatOk = await this.heartbeat(loopCtx);
                if (this.isShuttingDown()) {
                    iterLogger.debug("節點關閉中，跳過本輪剩餘步驟", { topic: LOG_TOPIC_NODE });
                    break;
                }
                await this.runLoopSteps(loopCtx, heartbeatOk);
            } catch (error) {
                iterLogger.critical(`主循環第 ${this.loopCount} 輪遇到未知錯誤`, {
                    topic: LOG_TOPIC_NODE,
                    data: { error: getErrorMessage(error) },
                });
            }
            if (this.isShuttingDown()) {
                iterLogger.debug("節點關閉中，跳過等待間隔", { topic: LOG_TOPIC_NODE });
                break;
            }
            const interval = this.getLoopIntervalMs();
            iterLogger.debug(`主循環第 ${this.loopCount} 輪完成，等待下一輪`, {
                topic: LOG_TOPIC_NODE,
                data: { intervalMs: interval },
            });
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }

    async shutdown(options?: { trigger?: string }): Promise<void> {
        if (this.shutdownPromise != null) {
            const logger = createLogger({
                scope: patchScope({ scope: this.startupScope, patch: { labels: { nodeId: this.getLogNodeId() } } }),
            });
            logger.debug("shutdown 已在進行，跳過重複調用", {
                topic: LOG_TOPIC_NODE,
                data: { trigger: options?.trigger ?? "unknown" },
            });
            return this.shutdownPromise;
        }

        this.isRunning = false;
        this.shutdownPromise = this.runShutdown(options?.trigger).catch(async (error) => {
            const logger = createLogger({
                scope: patchScope({ scope: this.startupScope, patch: { labels: { nodeId: this.getLogNodeId() } } }),
            });
            logger.error("shutdown 流程異常", {
                topic: LOG_TOPIC_NODE,
                data: {
                    trigger: options?.trigger ?? "explicit",
                    error: getErrorMessage(error),
                },
            });
            await this.exitProcess(1, logger);
        });
        return this.shutdownPromise;
    }

    private async runShutdown(trigger?: string): Promise<void> {
        const logger = createLogger({
            scope: patchScope({ scope: this.startupScope, patch: { labels: { nodeId: this.getLogNodeId() } } }),
        });

        logger.debug("正在關閉節點進程", {
            topic: LOG_TOPIC_NODE,
            data: { trigger: trigger ?? "explicit" },
        });

        if (this.localNodeId == null) {
            logger.warn("本地節點未註冊，進程退出", { topic: LOG_TOPIC_NODE });
            await this.exitProcess(0, logger);
            return;
        }

        logger.debug("正在登出節點", { topic: LOG_TOPIC_NODE, data: { nodeId: this.localNodeId } });
        try {
            const { error } = await patchStopNode({
                nodeId: this.localNodeId,
                traceId: this.startupTraceId,
            });
            if (error) {
                throw new Error(`patchStopNode 失敗: ${error.message}`);
            }
            logger.success("節點正常關閉，進程退出", { topic: LOG_TOPIC_NODE });
        } catch (error) {
            logger.critical("登出節點失敗，進程退出", {
                topic: LOG_TOPIC_NODE,
                data: { error: getErrorMessage(error) },
            });
        } finally {
            await this.exitProcess(0, logger);
        }
    }

    async heartbeat(ctx: NodeLoopContext): Promise<boolean> {
        const { loopTraceId, nodeId } = ctx;
        const logger = createLogger({
            scope: createScope({
                module: "heartbeat",
                traceId: loopTraceId,
                labels: { nodeId },
            }),
            minLevel: this.loopLoggerMinLevel(),
        });

        logger.debug("開始發送心跳", { topic: LOG_TOPIC_NODE });
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
                    topic: LOG_TOPIC_NODE,
                    data: logData,
                });
                this.requestShutdown("heartbeat:consecutive-failures");
            } else {
                logger.warn("心跳更新失敗", { topic: LOG_TOPIC_NODE, data: logData });
            }
            return false;
        }

        this.consecutiveHeartbeatFailures = 0;
        logger.info("心跳更新成功", {
            topic: LOG_TOPIC_NODE,
            data: { lastHeartBeat: formatHeartbeat(lastHeartBeat) },
        });
        return true;
    }

    async batchCommand(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId, nodeId } = ctx;
        const cmdLogger = createLogger({
            scope: createScope({
                module: "batchCommand",
                traceId: loopTraceId,
                labels: { nodeId },
            }),
            minLevel: this.loopLoggerMinLevel(),
        });

        cmdLogger.debug("開始檢查控制指令", { topic: LOG_TOPIC_COMMAND });
        const { data: commandList = [], error: pollError } = await getPollCommandList({
            nodeId,
            traceId: loopTraceId,
            size: MAX_POLL_TARGET_LIST_SIZE,
        });
        if (pollError) {
            cmdLogger.warn("獲取指令失敗", {
                topic: LOG_TOPIC_COMMAND,
                data: { error: pollError.message },
            });
            return;
        }
        if (commandList.length === 0) {
            cmdLogger.debug("獲取指令數量為0 無需執行", { topic: LOG_TOPIC_COMMAND });
            return;
        }
        cmdLogger.debug(`獲取到控制指令數量為${commandList.length}`, {
            topic: LOG_TOPIC_COMMAND,
            data: { count: commandList.length, commandList: commandList.map((command) => command.name) },
        });

        for (const command of commandList) {
            const cmd = command.name;
            cmdLogger.info("執行控制指令", {
                topic: LOG_TOPIC_COMMAND,
                data: { commandId: command.id, cmd },
            });
            try {
                await this.executeCommand(cmd, ctx);
                cmdLogger.success("控制指令執行成功", {
                    topic: LOG_TOPIC_COMMAND,
                    data: { commandId: command.id, cmd },
                });
            } catch (error) {
                cmdLogger.warn("控制指令執行失敗", {
                    topic: LOG_TOPIC_COMMAND,
                    data: {
                        commandId: command.id,
                        cmd,
                        error: getErrorMessage(error),
                    },
                });
            }
        }

        cmdLogger.debug("控制指令批次處理完成", {
            topic: LOG_TOPIC_COMMAND,
        });
    }

    /** Shared commands, then {@link resolveNodeCommand} for subclass-specific handling. */
    protected async executeCommand(cmd: CommandType, ctx: NodeLoopContext): Promise<void> {
        if (cmd === CommandType.STOP_NODE) {
            this.requestShutdown("cmd:STOP_NODE");
            return;
        }
        await this.resolveNodeCommand(cmd, ctx);
    }

    /**
     * Hook: handle node-type-specific {@link CommandType} values.
     * Default rejects anything not handled in {@link executeCommand}.
     */
    protected async resolveNodeCommand(cmd: CommandType, _ctx: NodeLoopContext): Promise<void> {
        throw new Error(`無法解析的 cmd: ${cmd}`);
    }
}

export { BaseNodeRuntime };
