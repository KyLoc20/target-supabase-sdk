import { z } from "zod";
import { createTarget, validateWithSchema } from "../core.api";
import type { SupabaseResponse } from "../core.interface";
import { createLogger, type LoggerWithScope, logManager } from "../shared/log";
import { CategoryTask, type Task, TaskStatus } from "./task.interface";

const traceIdSchema = z.string().trim().min(1).optional();
const traceParentIdSchema = z.string().trim().min(1).nullable().optional();

/** Initial status for a new task — OPEN (draft) or TODO (claimable by workers). */
const postTaskInitialStatusSchema = z
    .union([z.literal(TaskStatus.OPEN), z.literal(TaskStatus.TODO)])
    .optional()
    .default(TaskStatus.TODO);

export const postTaskSchema = z.object({
    name: z.string().trim().min(1),
    /** Task type key — matches `task.value`, {@link patchClaimTask}, {@link Repo.value}, and local Repo registry. */
    value: z.string().trim().min(1),
    params: z.unknown(),
    taskStatus: postTaskInitialStatusSchema,
    tagList: z.array(z.string()).optional().default([]),
    extra: z.string().optional(),
    traceId: traceIdSchema,
    traceParentId: traceParentIdSchema,
});

export type PostTaskPayload = z.infer<typeof postTaskSchema>;

export type CreateTaskRowInput = PostTaskPayload & {
    taskTraceId: string;
};

/** Shared DB insert for {@link postTask} and {@link postTaskWithValidation}. */
export async function createTaskRow(
    { name, value, params, taskStatus, tagList, extra, taskTraceId, traceParentId }: CreateTaskRowInput,
    logger: LoggerWithScope,
): Promise<SupabaseResponse<Task>> {
    const result = await createTarget<Task, PostTaskPayload>({
        payload: {
            name,
            value,
            params,
            taskStatus,
            tagList,
            extra,
            traceId: taskTraceId,
            traceParentId,
        },
        createFn: () => ({
            name,
            value,
            category: CategoryTask.TASK,
            tagList,
            extra,
            details: {
                manifestVersion: 0,
                status: taskStatus,
                params,
                progress: 0,
                nodeId: null,
                traceId: taskTraceId,
            },
        }),
    });

    logger.info("任務已創建", {
        topic: "task",
        data: {
            taskId: result.data?.id,
            taskTypeKey: value,
            status: taskStatus,
            traceId: taskTraceId,
        },
    });

    return result;
}

/**
 * Create a task row (scheduler / admin). **Browser and Node** — no Repo or params validation.
 * Execution-time checks live in {@link TaskManager.prepareTask}.
 */
export const postTask = validateWithSchema(
    postTaskSchema,
    "postTaskSchema",
)(async ({ name, value, params, taskStatus, tagList, extra, traceId, traceParentId }) => {
    const taskTraceId = traceId?.trim() || logManager.generateTraceId();
    const logger = createLogger({
        module: "postTask",
        traceId: taskTraceId,
        traceParentId: traceParentId ?? null,
    });

    return createTaskRow(
        { name, value, params, taskStatus, tagList, extra, traceId, traceParentId, taskTraceId },
        logger,
    );
});
