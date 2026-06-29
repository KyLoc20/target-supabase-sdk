import { createTarget, scanTargetList, updateTargetDetails, validateWithSchema } from "../core.api";
import { generateResponse, type SupabaseResponse } from "../core.interface";
import { TaskStatus } from "../task/task.interface";
import { createApiLogger } from "../shared/log";
import { z } from "zod";
import {
    CategoryTrigger,
    Trigger,
    TriggerStatus,
    type TriggerAction,
    type TriggerSchedule,
} from "./trigger.interface";

const TRIGGER_STATUS_FIELD = "details->>status" as const;

const traceIdSchema = z.string().trim().min(1).optional();

const dailyScheduleSchema = z.object({
    kind: z.literal("daily"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
});

const postTaskActionSchema = z.object({
    kind: z.literal("post_task"),
    taskTypeKey: z.string().trim().min(1),
    taskParams: z.unknown(),
    taskName: z.string().trim().min(1).optional(),
    taskStatus: z.enum([TaskStatus.OPEN, TaskStatus.TODO]).optional(),
});

export const postTriggerSchema = z.object({
    name: z.string().trim().min(1),
    value: z.string().trim().min(1),
    status: z.nativeEnum(TriggerStatus).optional().default(TriggerStatus.ENABLED),
    schedule: dailyScheduleSchema,
    action: postTaskActionSchema,
    tagList: z.array(z.string()).optional().default([]),
    traceId: traceIdSchema,
});

export type PostTriggerPayload = z.infer<typeof postTriggerSchema>;

export const scanEnabledTriggersSchema = z.object({
    traceId: traceIdSchema,
});

export type ScanEnabledTriggersPayload = z.infer<typeof scanEnabledTriggersSchema>;

export const patchTriggerFiredSchema = z.object({
    triggerId: z.string().trim().min(1),
    fireKey: z.string().trim().min(1),
    expectedLastFireKey: z.string().nullable().optional(),
    traceId: traceIdSchema,
});

export type PatchTriggerFiredPayload = z.infer<typeof patchTriggerFiredSchema>;

function enabledTriggerFilter() {
    return [{ field: TRIGGER_STATUS_FIELD, operator: "eq" as const, value: TriggerStatus.ENABLED }];
}

/** List all ENABLED triggers (Phase 1: in-memory due check). */
export const scanEnabledTriggers = validateWithSchema(
    scanEnabledTriggersSchema,
    "scanEnabledTriggersSchema"
)(async ({ traceId }) => {
    const logger = createApiLogger("scanEnabledTriggers", { traceId });

    try {
        const { data: triggerList } = await scanTargetList<Trigger>({
            category: CategoryTrigger.TRIGGER,
            filterList: enabledTriggerFilter(),
            orderBy: { field: "created_at", ascending: true },
        });

        const rows = triggerList ?? [];
        logger.info("已掃描 ENABLED Trigger", {
            topic: "trigger",
            data: { count: rows.length },
        });

        return generateResponse.success(rows);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return generateResponse.error(message) as SupabaseResponse<Trigger[]>;
    }
});

/** Create a trigger row (scheduler / admin). */
export const postTrigger = validateWithSchema(
    postTriggerSchema,
    "postTriggerSchema"
)(async ({ name, value, status, schedule, action, tagList, traceId }) => {
    const logger = createApiLogger("postTrigger", { traceId });

    const details = {
        manifestVersion: 0,
        status,
        schedule: schedule as TriggerSchedule,
        action: action as TriggerAction,
        lastFiredAt: null,
        lastFireKey: null,
    };

    const result = await createTarget<Trigger, PostTriggerPayload>({
        payload: { name, value, status, schedule, action, tagList, traceId },
        createFn: () => ({
            name,
            value,
            category: CategoryTrigger.TRIGGER,
            tagList,
            details,
        }),
    });

    logger.info("Trigger 已創建", {
        topic: "trigger",
        data: { triggerId: result.data?.id, triggerKey: value, status },
    });

    return result;
});

/**
 * Mark trigger as fired for `fireKey`.
 * When `expectedLastFireKey` is set, uses optimistic lock on that field.
 */
export const patchTriggerFired = validateWithSchema(
    patchTriggerFiredSchema,
    "patchTriggerFiredSchema"
)(async ({ triggerId, fireKey, expectedLastFireKey, traceId }) => {
    const logger = createApiLogger("patchTriggerFired", { traceId });
    const now = Date.now();

    try {
        const optimisticLockFilterList =
            expectedLastFireKey != null && expectedLastFireKey !== ""
                ? [{ field: "details->>lastFireKey" as const, operator: "eq" as const, value: expectedLastFireKey }]
                : [];

        const data = await updateTargetDetails<Trigger, Trigger["details"]>({
            id: triggerId,
            optimisticLockFilterList,
            updateFn: (current) => ({
                ...current,
                lastFireKey: fireKey,
                lastFiredAt: now,
            }),
        });

        logger.success("Trigger 觸發記錄已更新", {
            topic: "trigger",
            data: { triggerId, fireKey },
        });

        return generateResponse.success(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Trigger 觸發記錄更新失敗", {
            topic: "trigger",
            data: { triggerId, fireKey, error: message },
        });
        return generateResponse.error(message);
    }
});
