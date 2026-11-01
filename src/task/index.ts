/**
 * Task domain public API — curated re-exports only.
 * Internal modules (local-task-registry, task-repo-context) stay private.
 */

export type {
    PatchChangeTaskStatusPayload,
    PatchClaimTaskPayload,
    PatchTaskProgressPayload,
} from "./task.api";
// task.api
export {
    patchChangeTaskStatus,
    patchChangeTaskStatusSchema,
    patchClaimTask,
    patchClaimTaskSchema,
    patchTaskProgress,
    patchTaskProgressSchema,
} from "./task.api";
export type { Task, TaskDetails, TaskFlow } from "./task.interface";
// task.interface
export {
    CategoryTask,
    ResultCode,
    TaskStatus,
    TaskStatusAction,
} from "./task.interface";
export type {
    PrepareTaskParams,
    PrepareTaskResponse,
    RegisterTasksOptions,
    RegisterTasksResult,
} from "./task-manager";
// task-manager
export { TaskManager } from "./task-manager";
export type { PostTaskPayload } from "./task-post.api";
export { postTask, postTaskSchema } from "./task-post.api";
export type { PostTaskWithRetryOptions, PostTaskWithRetryResult } from "./task-post-retry.api";
export { POST_TASK_DEFAULT_MAX_ATTEMPTS, postTaskWithRetry } from "./task-post-retry.api";
export { postTaskWithValidation } from "./task-post-validated.api";
export type {
    CountTasksParams,
    HasActiveTasksParams,
    ListTasksParams,
    TaskSummary,
} from "./task-query.api";
export {
    buildTaskQueryFilters,
    countTasks,
    hasActiveTasks,
    listTasks,
    TASK_STATUS_FIELD,
    taskStatusFilterEq,
    taskStatusFilterIn,
    taskToSummary,
} from "./task-query.api";
export type {
    TaskRepoValidationFailureReason,
    ValidateTaskRepoAndParamsInput,
    ValidateTaskRepoAndParamsResult,
} from "./task-repo-validation";
// task-repo-validation
export { TaskRepoValidation } from "./task-repo-validation";
