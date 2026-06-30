/**
 * Node.js runtime entry — browser API plus local FS / worker orchestration.
 *
 * import { TaskManager, RepoManager, TaskNode } from "target-supabase-sdk/node";
 */

export * from "./browser";

export { TaskManager } from "./task/task-manager";
export type {
	PrepareTaskFailureReason,
	PrepareTaskParams,
	PrepareTaskResponse,
	RegisterTasksOptions,
	RegisterTasksResult,
	TaskFn,
	TaskRepoContext,
	TaskRunResult,
	ExecutableTaskFn,
	TaskRepoScriptDetails,
	TaskRepoScriptRecord,
	TaskRunnerRootConfig,
	TaskLocalPackageConfig,
	BootstrapLocalTasksResult,
	BootstrapLocalTasksStatus,
} from "./task/task-manager";
export {
	TASK_REPO_SCRIPT_CATEGORY,
	TASK_RUNNER_CONFIG_DIR,
	TASK_RUNNER_ROOT_CONFIG_FILENAME,
	TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH,
	TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH,
	TASK_LOCAL_PACKAGE_CONFIG_FILENAME,
} from "./task/task-manager";

export {
	postTask,
	postTaskSchema,
} from "./task/task-post.api";
export type { PostTaskPayload } from "./task/task-post.api";

export {
	TaskRepoValidation,
	validateTaskRepoAndParams,
} from "./task/task-repo-validation";
export type {
	TaskRepoValidationFailureReason,
	ValidateTaskRepoAndParamsInput,
	ValidateTaskRepoAndParamsResult,
} from "./task/task-repo-validation";

export { RepoManager } from "./repo/repo-manager";

export { TaskNode } from "./node/task-node";
export { TriggerNode } from "./node/trigger-node";
export { BaseNodeRuntime } from "./node/node-runtime.base";

export * from "./command/command.interface";
export * from "./command/command.api";

export * from "./trigger/trigger.interface";
export * from "./trigger/trigger.api";
