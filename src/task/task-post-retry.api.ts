import type { LoggerWithScope } from "../shared/log";
import type { Task } from "./task.interface";
import { type PostTaskPayload, postTask } from "./task-post.api";

export const POST_TASK_DEFAULT_MAX_ATTEMPTS = 3;

export interface PostTaskWithRetryOptions {
    logger: LoggerWithScope;
    topic: string;
    traceId: string;
    itemLabel: string;
    context?: Record<string, unknown>;
    maxAttempts?: number;
}

export type PostTaskWithRetryResult = { ok: true; task: Task } | { ok: false };

/**
 * Retry wrapper for {@link postTask} — for schedule runners posting tasks over flaky network.
 * Logs warn on intermediate failures and critical when all attempts fail.
 */
export async function postTaskWithRetry(
    payload: PostTaskPayload,
    options: PostTaskWithRetryOptions,
): Promise<PostTaskWithRetryResult> {
    const maxAttempts = options.maxAttempts ?? POST_TASK_DEFAULT_MAX_ATTEMPTS;
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data: task, error } = await postTask(payload);
        if (error == null && task != null) {
            return { ok: true, task };
        }
        lastError = error?.message ?? lastError;
        if (attempt < maxAttempts) {
            options.logger.warn("postTask failed, retrying", {
                topic: options.topic,
                data: {
                    ...options.context,
                    traceId: options.traceId,
                    itemLabel: options.itemLabel,
                    attempt,
                    maxAttempts,
                    error: lastError,
                },
            });
        }
    }

    options.logger.critical("postTask failed after retries — skip item this cycle", {
        topic: options.topic,
        data: {
            ...options.context,
            traceId: options.traceId,
            itemLabel: options.itemLabel,
            maxAttempts,
            error: lastError,
        },
    });
    return { ok: false };
}
