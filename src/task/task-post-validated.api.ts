import { validateWithSchema } from "../core.api";
import { generateResponse, type SupabaseResponse } from "../core.interface";
import { createLogger, logManager } from "../shared/log";
import type { Task } from "./task.interface";
import { createTaskRow, postTaskSchema } from "./task-post.api";
import { TaskRepoValidation } from "./task-repo-validation";

/**
 * Create a task row with publish-time Repo + params validation.
 * **Node entry only** — requires local Repo bootstrap and {@link TaskRepoValidation}.
 *
 * @see target-supabase-sdk/node
 */
export const postTaskWithValidation = validateWithSchema(
    postTaskSchema,
    "postTaskSchema",
)(async ({ name, value, params, taskStatus, tagList, extra, traceId, traceParentId }) => {
    const taskTraceId = traceId?.trim() || logManager.generateTraceId();
    const logger = createLogger({
        module: "postTaskWithValidation",
        traceId: taskTraceId,
        traceParentId: traceParentId ?? null,
    });

    const validation = await TaskRepoValidation.validate({
        logger,
        taskTypeKey: value,
        params,
        bootstrapLocal: true,
    });
    if (!validation.isValid) {
        logger.warn(validation.message, {
            topic: "task",
            data: {
                taskTypeKey: value,
                reason: validation.reason,
                step: validation.step,
            },
        });
        return generateResponse.error(validation.message, undefined, String(validation.code)) as SupabaseResponse<Task>;
    }

    return createTaskRow(
        { name, value, params, taskStatus, tagList, extra, traceId, traceParentId, taskTraceId },
        logger,
    );
});
