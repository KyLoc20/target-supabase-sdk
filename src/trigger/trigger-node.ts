import { createLogger, createScope, LogLevel, type LoggerWithScope } from "../shared/log";
import { BaseNodeRuntime, type NodeLoopContext } from "../node/node-runtime.base";
import { postTask } from "../task/task-post.api";
import { TaskStatus } from "../task/task.interface";
import { patchTriggerFired, scanEnabledTriggers } from "./trigger.api";
import type { Trigger, TriggerPostTaskAction } from "./trigger.interface";
import { buildFireKey, isTriggerDue } from "./trigger.utils";

const LOG_TOPIC_TRIGGER = "trigger";

/**
 * Dedicated trigger scheduler node.
 * Main loop: commands → heartbeat → evaluate due triggers → postTask.
 *
 * Phase 1: run a **single** TriggerNode process per deployment to avoid duplicate fires.
 */
class TriggerNode extends BaseNodeRuntime {
    constructor() {
        super("triggerNode");
    }

    protected async onBeforeRegisterNode(logger: LoggerWithScope): Promise<void> {
        logger.info("Trigger 節點啟動，跳過任務註冊", { topic: LOG_TOPIC_TRIGGER });
    }

    protected loopLoggerMinLevel(): LogLevel {
        return LogLevel.WARN;
    }

    protected async runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void> {
        const loopScope = createScope({
            module: `${this.runtimeModule}-loop-iteration`,
            traceId: ctx.loopTraceId,
            labels: { nodeId: ctx.nodeId },
        });
        if (!heartbeatOk) {
            const logger = createLogger({ scope: loopScope });
            logger.warn("心跳失敗，本輪跳過 Trigger 評估", { topic: LOG_TOPIC_TRIGGER });
            return;
        }
        await this.evaluateTriggers(ctx);
    }

    async evaluateTriggers(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId, nodeId } = ctx;
        const loopScope = createScope({ module: "evaluateTriggers", traceId: loopTraceId, labels: { nodeId } });
        const logger = createLogger({ scope: loopScope });

        logger.debug("開始評估 Trigger", { topic: LOG_TOPIC_TRIGGER });

        const { data: triggerList = [], error } = await scanEnabledTriggers({ traceId: loopTraceId });
        if (error) {
            logger.warn("掃描 Trigger 失敗", {
                topic: LOG_TOPIC_TRIGGER,
                data: { error: error.message },
            });
            return;
        }
        if (triggerList.length === 0) {
            logger.debug("無 ENABLED Trigger", { topic: LOG_TOPIC_TRIGGER });
            return;
        }

        const now = new Date();
        let dueCount = 0;
        let firedCount = 0;

        for (const trigger of triggerList) {
            if (!isTriggerDue(trigger, now)) {
                continue;
            }
            dueCount++;
            const fired = await this.fireTrigger(ctx, trigger, now);
            if (fired) {
                firedCount++;
            }
        }

        if (firedCount === 0) {
            logger.debug("Trigger 評估完成", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    scanned: triggerList.length,
                    due: dueCount,
                    fired: firedCount,
                },
            });
        } else {
            logger.info("Trigger 評估完成", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    scanned: triggerList.length,
                    due: dueCount,
                    fired: firedCount,
                },
            });
        }
    }

    private async fireTrigger(ctx: NodeLoopContext, trigger: Trigger, now: Date): Promise<boolean> {
        const { loopTraceId, nodeId } = ctx;
        const logger = createLogger({
            scope: createScope({ module: "fireTrigger", traceId: loopTraceId, labels: { nodeId } }),
        });

        const fireKey = buildFireKey(trigger, now);
        const action = trigger.details.action;

        if (action.kind !== "post_task") {
            logger.warn("不支援的 Trigger action", {
                topic: LOG_TOPIC_TRIGGER,
                data: { triggerId: trigger.id, kind: action.kind },
            });
            return false;
        }

        logger.info("Trigger 到期，準備 postTask", {
            topic: LOG_TOPIC_TRIGGER,
            data: {
                triggerId: trigger.id,
                triggerKey: trigger.value,
                fireKey,
                taskTypeKey: action.taskTypeKey,
            },
        });

        const taskExtra = `trigger:${trigger.id}:${fireKey}`;
        const { data: task, error: postError } = await postTask(
            buildPostTaskPayload(trigger, action, taskExtra, loopTraceId)
        );

        if (postError) {
            logger.error("Trigger postTask 失敗", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    triggerId: trigger.id,
                    fireKey,
                    error: postError.message,
                },
            });
            return false;
        }

        const { error: patchError } = await patchTriggerFired({
            triggerId: trigger.id,
            fireKey,
            expectedLastFireKey: trigger.details.lastFireKey ?? null,
            traceId: loopTraceId,
        });

        if (patchError) {
            logger.warn("Trigger 已 postTask 但更新 lastFireKey 失敗", {
                topic: LOG_TOPIC_TRIGGER,
                data: {
                    triggerId: trigger.id,
                    taskId: task?.id,
                    fireKey,
                    error: patchError.message,
                },
            });
            return false;
        }

        logger.success("Trigger 觸發成功", {
            topic: LOG_TOPIC_TRIGGER,
            data: {
                triggerId: trigger.id,
                triggerKey: trigger.value,
                fireKey,
                taskId: task?.id,
                taskTraceId: task?.details.traceId,
            },
        });
        return true;
    }
}

function buildPostTaskPayload(
    trigger: Trigger,
    action: TriggerPostTaskAction,
    extra: string,
    loopTraceId: string
) {
    return {
        name: action.taskName ?? trigger.name,
        value: action.taskTypeKey,
        params: action.taskParams,
        taskStatus: action.taskStatus ?? TaskStatus.TODO,
        tagList: trigger.tagList ?? [],
        extra,
        traceParentId: loopTraceId,
    };
}

export { TriggerNode };
