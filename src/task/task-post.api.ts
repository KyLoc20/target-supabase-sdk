import { createTarget, validateWithSchema } from "../core.api";
import { generateResponse, type SupabaseResponse } from "../core.interface";
import { createLogger, logManager } from "../shared/log";
import { z } from "zod";
import { CategoryTask, ResultCode, Task, TaskStatus } from "./task.interface";
import { TaskRepoValidation } from "./task-repo-validation";

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

/**
 * Create a task row (scheduler / admin). **Node entry only** — requires local Repo bootstrap.
 *
 * @see target-supabase-sdk/node
 */
export const postTask = validateWithSchema(
	postTaskSchema,
	"postTaskSchema",
)(async ({
	name,
	value,
	params,
	taskStatus,
	tagList,
	extra,
	traceId,
	traceParentId,
}) => {
	const taskTraceId = traceId?.trim() || logManager.generateTraceId();
	const logger = createLogger({
		module: "postTask",
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
		return generateResponse.error(
			validation.message,
			undefined,
			String(validation.code),
		) as SupabaseResponse<Task>;
	}

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
});
