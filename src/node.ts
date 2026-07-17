/**
 * Node.js runtime entry — browser API plus local FS / worker orchestration.
 *
 * import { TaskManager, RepoManager, TaskNode } from "target-supabase-sdk/node";
 */

export * from "./browser";
export * from "./command/command.api";
export * from "./command/command.interface";
export type {
    EnvIntOptions,
    EnvNumberOptions,
    EnvProfileFromProcessOptions,
    InitSupabaseFromStandardEnvOptions,
    LoadEnvFilesOptions,
    PublicBaseUrlFromEnvOptions,
} from "./node/env";
export {
    CLI_PROD_FLAG,
    envBool,
    envInt,
    envMs,
    envNumber,
    envPort,
    envProfileFromProcess,
    initSupabaseFromStandardEnv,
    loadEnvFiles,
    parseEnvFile,
    parseEnvLine,
    pinEnvProfileFromArgv,
    publicBaseUrlFromEnv,
    readEnv,
    requireEnv,
    resolveDefaultEnvFiles,
    resolveProjectRootByPackageName,
    resolveProjectRootFromModule,
    SERVICE_ENV_PROFILE_ENV_KEY,
    SERVICE_ENV_PROFILE_PROD,
} from "./node/env";
export type {
    CreateJsonFileStateStoreOptions,
    JsonFileStateStore,
    JsonStatePatch,
} from "./node/fs/json-state-store";
export { createJsonFileStateStore } from "./node/fs/json-state-store";
export type {
    ReadAndVerifySourceFileOptions,
    SourceFilePayload,
} from "./node/fs/read-source-file";
export {
    nodeBufferToArrayBuffer,
    readAndVerifySourceFile,
} from "./node/fs/read-source-file";
export type { BaseNodeRuntimeOptions, NodeLoopContext } from "./node/node-runtime.base";
export { BaseNodeRuntime } from "./node/node-runtime.base";
export type {
    BuildNodeImportArgsInput,
    ManagedChildProcessesOptions,
    SpawnChildResult,
    SpawnTsxChildOptions,
    StopAllChildrenOptions,
} from "./node/process";
export {
    buildNodeImportArgs,
    isChildProcessRunning,
    ManagedChildProcesses,
    spawnTsxChild,
} from "./node/process";
export type {
    PathsExistCheckOptions,
    PollUntilOptions,
    ReadinessCheck,
    ReadinessCheckResult,
    ReadinessReport,
    RequiredEnvCheckOptions,
    ServiceReadyGate,
    ServiceReadySnapshot,
    SupabaseReachableCheckOptions,
    WaitForServiceReadyOptions,
} from "./node/readiness";
export {
    createPathsExistCheck,
    createRequiredEnvCheck,
    createSupabaseReachableCheck,
    pollUntil,
    runReadinessChecks,
    waitForServiceReady,
} from "./node/readiness";
export { RepoManager } from "./repo/repo-manager";
export {
    disableLogPersist,
    enableLogPersist,
    ensureLogPersistFromEnv,
    getLogPersistStats,
    logPersistEnabledFromEnv,
    resolveLogPersistRegistryPath,
    snapshotLogPersistReady,
    validateLogPersistPreloadEnv,
    waitForLogPersistReady,
} from "./shared/log/enable-log-persist";
export type {
    EnableLogPersistOptions,
    EnsureLogPersistFromEnvOptions,
    LogPersistLane,
    LogPersistReadySnapshot,
    LogPersistStats,
    WaitForLogPersistReadyOptions,
} from "./shared/log/log-persist.interface";
export type {
    BootstrapLocalTasksResult,
    BootstrapLocalTasksStatus,
    ExecutableTaskFn,
    PrepareTaskParams,
    PrepareTaskResponse,
    RegisterTasksOptions,
    RegisterTasksResult,
    TaskFn,
    TaskLocalPackageConfig,
    TaskRepoContext,
    TaskRepoScriptDetails,
    TaskRepoScriptRecord,
    TaskRunnerRootConfig,
    TaskRunResult,
} from "./task/task-manager";
export {
    TASK_LOCAL_PACKAGE_CONFIG_FILENAME,
    TASK_REPO_SCRIPT_CATEGORY,
    TASK_RUNNER_CONFIG_DIR,
    TASK_RUNNER_ROOT_CONFIG_FILENAME,
    TASK_RUNNER_ROOT_CONFIG_LEGACY_RELATIVE_PATH,
    TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH,
    TaskManager,
} from "./task/task-manager";
export { TaskNode } from "./task/task-node";
export type { PostTaskPayload } from "./task/task-post.api";
export { postTaskWithValidation } from "./task/task-post-validated.api";
export type {
    TaskRepoValidationFailureReason,
    ValidateTaskRepoAndParamsInput,
    ValidateTaskRepoAndParamsResult,
} from "./task/task-repo-validation";
export {
    TaskRepoValidation,
    validateTaskRepoAndParams,
} from "./task/task-repo-validation";
export * from "./trigger/trigger.api";
export {
    LOG_TOPIC_TRIGGER,
    TRIGGER_LOOP_INTERVAL_MS,
    TRIGGER_RUNNER_DEFAULT_RETRY_COUNT,
    TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS,
} from "./trigger/trigger.constant";
export type {
    RegisterTriggerRunnerOptions,
    TriggerNodeOptions,
    TriggerRunnerContext,
    TriggerRunnerFn,
} from "./trigger/trigger.interface";
export * from "./trigger/trigger.interface";
export { TriggerManager } from "./trigger/trigger-manager";
export { TriggerNode } from "./trigger/trigger-node";
