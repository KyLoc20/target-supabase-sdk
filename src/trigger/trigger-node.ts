import { BaseNodeRuntime, LOG_TOPIC_NODE, type NodeLoopContext } from "../node/node-runtime.base";
import { createLogger, createScope, type LoggerWithScope, LogLevel } from "../shared/log";
import { LOG_TOPIC_TRIGGER, TRIGGER_LOOP_INTERVAL_MS } from "./trigger.constant";
import type { TriggerNodeOptions } from "./trigger.interface";
import { TriggerManager } from "./trigger-manager";

/**
 * Local interval scheduler node.
 * Main loop: commands → heartbeat → {@link TriggerManager.tick}.
 *
 * Register runners via {@link TriggerManager.registerRunner} before {@link start}.
 * Does not scan Supabase trigger rows — see `trigger.api.ts` for remote admin APIs.
 *
 * Deploy **one** TriggerNode per logical scheduler — multiple processes duplicate runner work.
 */
class TriggerNode extends BaseNodeRuntime {
    private readonly requireRunners: boolean;

    constructor(options?: TriggerNodeOptions) {
        super("triggerNode", { beforeProcessExit: options?.beforeProcessExit });
        this.requireRunners = options?.requireRunners ?? false;
    }

    protected getLoopIntervalMs(): number {
        return TRIGGER_LOOP_INTERVAL_MS;
    }

    protected loopLoggerMinLevel(): LogLevel {
        return LogLevel.WARN;
    }

    protected async onBeforeRegisterNode(logger: LoggerWithScope): Promise<void> {
        TriggerManager.closeRegistration();

        const runnerKeys = TriggerManager.getRunnerKeys();
        if (runnerKeys.length === 0) {
            if (this.requireRunners) {
                throw new Error("[TriggerNode] requireRunners is true but no runners are registered");
            }
            logger.warn("未注册任何 Trigger runner，主循環將空轉", {
                topic: LOG_TOPIC_TRIGGER,
            });
            return;
        }

        for (const { key, intervalMs } of TriggerManager.getRunnersBelowLoopInterval()) {
            logger.warn("Runner interval 小於主循環 tick 間隔，實際觸發精度受限", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    runnerKey: key,
                    intervalMs,
                    loopIntervalMs: TRIGGER_LOOP_INTERVAL_MS,
                },
            });
        }

        logger.success("Trigger 節點啟動", {
            topic: LOG_TOPIC_TRIGGER,
            data: { runnerKeys },
        });
    }

    protected async runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void> {
        if (!heartbeatOk) {
            const logger = createLogger({
                scope: createScope({
                    module: `${this.runtimeModule}-runLoopSteps`,
                    traceId: ctx.loopTraceId,
                    labels: { nodeId: ctx.nodeId },
                }),
            });
            logger.warn("心跳失敗，本輪跳過 runner", { topic: LOG_TOPIC_NODE });
            return;
        }
        await TriggerManager.tick(ctx);
    }
}

export type { TriggerNodeOptions } from "./trigger.interface";
export { TriggerNode };
