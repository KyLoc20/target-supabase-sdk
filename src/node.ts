/**
 * Node.js runtime entry — browser API plus local FS / worker orchestration.
 *
 * import { TaskManager, RepoManager, TaskNode } from "target-supabase-sdk/node";
 */

export * from "./browser";

export { TaskManager } from "./task/task-manager";
export type {
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

export { TaskNode } from "./task/task-node";
export { TriggerNode } from "./trigger/trigger-node";
export type { TriggerNodeOptions } from "./trigger/trigger.interface";
export { TriggerManager } from "./trigger/trigger-manager";
export type {
	RegisterTriggerRunnerOptions,
	TriggerRunnerContext,
	TriggerRunnerFn,
} from "./trigger/trigger.interface";
export {
	LOG_TOPIC_TRIGGER,
	TRIGGER_LOOP_INTERVAL_MS,
	TRIGGER_RUNNER_DEFAULT_RETRY_COUNT,
	TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS,
} from "./trigger/trigger.constant";
export { BaseNodeRuntime } from "./node/node-runtime.base";

export {
	buildNodeImportArgs,
	spawnTsxChild,
	isChildProcessRunning,
	ManagedChildProcesses,
} from "./node/process";
export type {
	BuildNodeImportArgsInput,
	SpawnTsxChildOptions,
	ManagedChildProcessesOptions,
	SpawnChildResult,
	StopAllChildrenOptions,
} from "./node/process";

export {
	runReadinessChecks,
	createRequiredEnvCheck,
	createPathsExistCheck,
	createSupabaseReachableCheck,
	pollUntil,
	waitForServiceReady,
} from "./node/readiness";
export type {
	ReadinessCheck,
	ReadinessCheckResult,
	ReadinessReport,
	RequiredEnvCheckOptions,
	PathsExistCheckOptions,
	SupabaseReachableCheckOptions,
	PollUntilOptions,
	ServiceReadyGate,
	ServiceReadySnapshot,
	WaitForServiceReadyOptions,
} from "./node/readiness";

export {
	loadEnvFiles,
	parseEnvLine,
	parseEnvFile,
	readEnv,
	requireEnv,
	envInt,
	envMs,
	envPort,
	envNumber,
	envBool,
	resolveProjectRootFromModule,
	resolveProjectRootByPackageName,
	publicBaseUrlFromEnv,
	initSupabaseFromStandardEnv,
} from "./node/env";
export type {
	LoadEnvFilesOptions,
	EnvIntOptions,
	EnvNumberOptions,
	PublicBaseUrlFromEnvOptions,
	InitSupabaseFromStandardEnvOptions,
} from "./node/env";

export {
	readAndVerifySourceFile,
	nodeBufferToArrayBuffer,
} from "./node/fs/read-source-file";
export type {
	ReadAndVerifySourceFileOptions,
	SourceFilePayload,
} from "./node/fs/read-source-file";

export { createJsonFileStateStore } from "./node/fs/json-state-store";
export type {
	CreateJsonFileStateStoreOptions,
	JsonFileStateStore,
	JsonStatePatch,
} from "./node/fs/json-state-store";

export * from "./command/command.interface";
export * from "./command/command.api";

export * from "./trigger/trigger.interface";
export * from "./trigger/trigger.api";
