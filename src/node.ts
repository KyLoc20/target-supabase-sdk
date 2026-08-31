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
    CreateManagedChildProcessesOptions,
    CriticalExitHandler,
    ManagedChildProcessesOptions,
    SpawnChildOptions,
    SpawnChildResult,
    SpawnTsxChildOptions,
    StopAllChildrenOptions,
} from "./node/process";
export {
    buildNodeImportArgs,
    createManagedChildProcesses,
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
export type {
    CreateServiceRuntimeStateStoreOptions,
    FinishRunnerTickOptions,
    GuardRuntimeSlice,
    ReadinessRuntimeSlice,
    ReadinessStatus,
    SchedulerRuntimeSlice,
    ServiceRuntimeCoreNestedKey,
    ServiceRuntimeExtraSlicePatch,
    ServiceRuntimeNestedKeys,
    ServiceRuntimeState,
    ServiceRuntimeStateStore,
    WorkerRuntimeSlice,
} from "./node/runtime-state";
export { createServiceRuntimeStateStore } from "./node/runtime-state";
export type {
    ApplyRegistrySlotGuardInput,
    ApplyRegistrySlotGuardResult,
    RegisterServiceGuardRunnerOptions,
    RunReadinessGateInput,
    ServiceGuardNodeOptions,
    ServiceGuardTickInput,
    ServiceGuardTickResult,
    ServiceHost,
    ServiceHostClosable,
    ServiceHostContext,
    ServiceHostOptions,
    SingleProcessServiceContext,
    SingleProcessServiceOptions,
} from "./node/service-host";
export {
    applyRegistrySlotGuardStep,
    COLLECT_LOG_RUNNER_KEY,
    createServiceHost,
    getWorkerSpawnCooldownLastAt,
    markWorkerSpawned,
    registerCollectLogRunner,
    registerServiceGuardRunner,
    runReadinessGate,
    runServiceGuardTick,
    runSingleProcessService,
    SERVICE_GUARD_RUNNER_KEY,
    ServiceGuardNode,
} from "./node/service-host";
export { RepoManager } from "./repo/repo-manager";
export { runCollectLogTick } from "./shared/log/spool/collector";
export { LOG_SPOOL_SERVICE_ID_ENV } from "./shared/log/spool/config";
export type { LogSpoolCoordinator, LogSpoolCoordinatorOptions } from "./shared/log/spool/coordinator";
export { createLogSpoolCoordinator } from "./shared/log/spool/coordinator";
export {
    buildLogSpoolSpawnEnv,
    ensureLogSpoolFromEnv,
    getLogSpoolStats,
    logSpoolEnabledFromEnv,
    shutdownLogSpoolFromEnv,
    validateLogSpoolPreloadEnv,
} from "./shared/log/spool/enable";
export type {
    EnableLogSpoolOptions,
    LogSpoolCoreProcessRole,
    LogSpoolProcessRole,
    LogSpoolWriterStats,
} from "./shared/log/spool/interface";
export { resolveLogSpoolRoot } from "./shared/log/spool/paths";
export {
    enableLogSpoolFromEnvInChild,
    getMainLogSpoolWriterStats,
    isLogSpoolEnabled,
    shutdownLogSpool,
} from "./shared/log/spool/service-lifecycle";
export type { LogBatchMeta, LogPersistLane } from "./shared/log/upload/interface";
export type {
    ConfigSchema,
    LoadCachedJsConfigOptions,
    ResolveFirstExistingPathOptions,
} from "./shared/utils/config-path.utils";
export {
    getConfigFileDir,
    importJsConfigModule,
    loadCachedJsConfigModule,
    pathExists,
    resolveFirstExistingPath,
    resolvePathFromBaseDir,
    resolvePathFromConfigFile,
    resolvePathFromCwd,
    toFileImportHref,
} from "./shared/utils/config-path.utils";
export { getValueAtPath } from "./shared/utils/get-value-at-path";
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
export { postTask, postTaskSchema } from "./task/task-post.api";
export type { PostTaskWithRetryOptions, PostTaskWithRetryResult } from "./task/task-post-retry.api";
export { POST_TASK_DEFAULT_MAX_ATTEMPTS, postTaskWithRetry } from "./task/task-post-retry.api";
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
