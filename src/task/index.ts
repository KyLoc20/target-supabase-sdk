/**
 * Task domain public API — curated re-exports only.
 * Internal modules (local-task-registry, task-repo-context, task.utils) stay private.
 */

// task.interface
export {
	CategoryTask,
	ResultCode,
	TaskStatus,
	TaskStatusAction,
} from "./task.interface";
export type { Task, TaskDetails, TaskFlow } from "./task.interface";

// task.api
export {
	patchChangeTaskStatus,
	patchChangeTaskStatusSchema,
	patchClaimTask,
	patchClaimTaskSchema,
	patchTaskProgress,
	patchTaskProgressSchema,
	postTask,
	postTaskSchema,
} from "./task.api";
export type {
	PatchChangeTaskStatusPayload,
	PatchClaimTaskPayload,
	PatchTaskProgressPayload,
	PostTaskPayload,
} from "./task.api";

// task-manager
export { TaskManager } from "./task-manager";
export type {
	PrepareTaskFailureReason,
	PrepareTaskParams,
	PrepareTaskResponse,
	RegisterTasksOptions,
	RegisterTasksResult,
} from "./task-manager";

// task-repo-validation
export { TaskRepoValidation } from "./task-repo-validation";
export type {
	TaskRepoValidationFailureReason,
	ValidateTaskRepoAndParamsInput,
	ValidateTaskRepoAndParamsResult,
} from "./task-repo-validation";
