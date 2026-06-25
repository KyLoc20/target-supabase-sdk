import { logManager, type LoggerWithContext } from "../shared/log/log-manager";
import { postTask } from "../task/task.api";
import { TaskStatus } from "../task/task.interface";
import { patchTriggerFired, scanEnabledTriggers } from "../trigger/trigger.api";
import type { Trigger, TriggerPostTaskAction } from "../trigger/trigger.interface";
import { buildFireKey, isTriggerDue } from "../trigger/trigger.utils";
import { NodeLoopContext } from "./node.interface";
import { BaseNodeRuntime } from "./node-runtime.base";

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

    protected async onBeforeRegisterNode(logger: LoggerWithContext): Promise<void> {
        logger.info("Trigger 節點啟動，跳過任務註冊", { topic: "trigger" });
    }

    protected async runLoopSteps(ctx: NodeLoopContext, heartbeatOk: boolean): Promise<void> {
        if (!heartbeatOk) {
            const { logger } = logManager.withContext({
                module: `${this.runtimeModule}-loop-iteration`,
                traceId: ctx.loopTraceId,
                nodeId: ctx.nodeId,
            });
            logger.warn("心跳失敗，本輪跳過 Trigger 評估", { topic: "trigger" });
            return;
        }
        await this.evaluateTriggers(ctx);
    }

    async evaluateTriggers(ctx: NodeLoopContext): Promise<void> {
        const { loopTraceId } = ctx;
        const { logger } = logManager.withContext({
            module: "evaluateTriggers",
            traceId: loopTraceId,
            nodeId: ctx.nodeId,
        });

        logger.debug("開始評估 Trigger", { topic: "trigger" });

        const { data: triggerList = [], error } = await scanEnabledTriggers({ traceId: loopTraceId });
        if (error) {
            logger.warn("掃描 Trigger 失敗", {
                topic: "trigger",
                context: { error: error.message },
            });
            return;
        }
        if (triggerList.length === 0) {
            logger.info("無 ENABLED Trigger", { topic: "trigger" });
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

        logger.info("Trigger 評估完成", {
            topic: "trigger",
            context: {
                scanned: triggerList.length,
                due: dueCount,
                fired: firedCount,
            },
        });
    }

    private async fireTrigger(ctx: NodeLoopContext, trigger: Trigger, now: Date): Promise<boolean> {
        const { loopTraceId } = ctx;
        const { logger } = logManager.withContext({
            module: "fireTrigger",
            traceId: loopTraceId,
            nodeId: ctx.nodeId,
        });

        const fireKey = buildFireKey(trigger, now);
        const action = trigger.details.action;

        if (action.kind !== "post_task") {
            logger.warn("不支援的 Trigger action", {
                topic: "trigger",
                context: { triggerId: trigger.id, kind: action.kind },
            });
            return false;
        }

        logger.info("Trigger 到期，準備 postTask", {
            topic: "trigger",
            context: {
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
                topic: "trigger",
                context: {
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
                topic: "trigger",
                context: {
                    triggerId: trigger.id,
                    taskId: task?.id,
                    fireKey,
                    error: patchError.message,
                },
            });
            return false;
        }

        logger.success("Trigger 觸發成功", {
            topic: "trigger",
            context: {
                triggerId: trigger.id,
                triggerKey: trigger.value,
                fireKey,
                taskId: task?.id,
            },
        });
        return true;
    }
}

function buildPostTaskPayload(
    trigger: Trigger,
    action: TriggerPostTaskAction,
    extra: string,
    traceId: string
) {
    return {
        name: action.taskName ?? trigger.name,
        value: action.taskTypeKey,
        params: action.taskParams,
        taskStatus: action.taskStatus ?? TaskStatus.TODO,
        tagList: trigger.tagList ?? [],
        extra,
        traceId,
    };
}

export { TriggerNode };
