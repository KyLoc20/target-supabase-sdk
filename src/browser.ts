/**
 * Browser-safe public API — no Node.js built-ins (node:fs, node:crypto, …).
 * Default package entry (`target-supabase-sdk`).
 *
 * For TaskManager, RepoManager, TaskNode, use `target-supabase-sdk/node`.
 */

export type { SupabaseClient } from "@supabase/supabase-js";
export * from "./core.api";
export * from "./core.interface";
export * from "./core.schema";
export * from "./core.utils";
export type {
    GetExtractionPayload,
    PatchExtractionObjectsPayload,
    PostExtractionPayload,
    ScanExtractionListPayload,
} from "./extraction/extraction.api";
export {
    getExtraction,
    getExtractionSchema,
    patchExtractionObjects,
    patchExtractionObjectsSchema,
    postExtraction,
    postExtractionSchema,
    scanExtractionList,
    scanExtractionListSchema,
} from "./extraction/extraction.api";
export type { Extraction, ExtractionDetails } from "./extraction/extraction.interface";
export { CategoryExtraction } from "./extraction/extraction.interface";
export * from "./link/index";
export * from "./list/index";
export * from "./node/node.api";
export * from "./node/node.interface";
export type {
    EvaluateBusyNodeLivenessOptions,
    TaskNodeLivenessFreshest,
    TaskNodeLivenessReport,
} from "./node/node-liveness";
export { evaluateBusyNodeLiveness } from "./node/node-liveness";
export type { ChunkResolveProvider } from "./parcel/chunk-fetch-registry";
export {
    installChunkFetchRegistry,
    registerProviderChunkResolver,
} from "./parcel/chunk-fetch-registry";
export {
    isLocalFilesystemPath,
    isOpaqueChunkUrl,
    parseProviderPrefixedUrl,
} from "./parcel/chunk-url.utils";
export type { DeleteParcelPayload, GetParcelPayload, PostParcelPayload } from "./parcel/parcel.api";
export {
    deleteParcel,
    deleteParcelSchema,
    getParcel,
    getParcelSchema,
    parcelDetailsSchema,
    postParcel,
    postParcelSchema,
} from "./parcel/parcel.api";
export type {
    Chunk,
    Lifecycle as ParcelLifecycle,
    LifecycleStatus as ParcelLifecycleStatus,
    Parcel,
    ParcelCrypto,
    ParcelDetails,
} from "./parcel/parcel.interface";
export { CategoryParcel } from "./parcel/parcel.interface";
export type {
    PublishParcelInput,
    PublishParcelResult,
    RestoreParcelByIdInput,
    RestoreParcelByIdResult,
} from "./parcel/parcel.service";
export {
    publishParcel,
    restoreParcel,
    restoreParcelById,
} from "./parcel/parcel.service";
export type {
    CreateOptions,
    CreateResult,
    ParcelSaveInput,
    ReassembleOptions,
    StorageAdapter,
} from "./parcel/parcel-manager";
export { ParcelManager } from "./parcel/parcel-manager";
export type {
    CreateUploadAdapterOptions,
    ProviderProbeFail,
    ProviderProbeOk,
    ProviderProbeResult,
    StorageProviderModule,
    UploadTracker,
} from "./parcel/storage-provider.types";
export { createUploadTracker } from "./parcel/storage-provider.types";
export type { ProviderProbeMap, StorageProviderRegistry } from "./parcel/storage-provider-registry";
export { createStorageProviderRegistry } from "./parcel/storage-provider-registry";
export * from "./repo/repo.api";
export * from "./repo/repo.interface";
export type {
    Api,
    ApiDetails,
    AppendSystemRegistrySlotsInput,
    AppendSystemRegistrySlotsOutcome,
    ClaimRegistrySlotInput,
    Config,
    ConfigDetails,
    GetApiPayload,
    GetConfigPayload,
    GetServicePayload,
    PatchServiceRuntimeInput,
    PostApiPayload,
    PostServiceInstanceOptions,
    PostServicePayload,
    PostSystemRegistryConfigPayload,
    RegisterServiceInput,
    RegistrySlotGuardResult,
    RegistrySlotRuntimeState,
    ReleasedRegistrySlot,
    ReleaseSystemRegistrySlotsInput,
    ReleaseSystemRegistrySlotsOutcome,
    ResetSystemRegistryConfigPayload,
    Service,
    ServiceBootstrapResult,
    ServiceDetails,
    ServiceNodeSnapshot,
    ServiceRegistrySession,
    ServiceRuntime,
    ServiceSlot,
    SystemRegistrySeedSlot,
    TargetSystemRegistrySlotView,
    TargetSystemRegistryView,
} from "./service/index";
export {
    ApiMethod,
    apiDetailsSchema,
    appendSystemRegistrySlots,
    assertRegistrySlotAvailable,
    assertRegistrySlotOwner,
    buildEmptyServiceSlots,
    buildSystemRegistryConfigDetails,
    CategoryConfig,
    CategoryService,
    claimServiceRegistrySlot,
    createActiveServiceLifecycle,
    createClaimedRegistrySlotRuntimeState,
    DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS,
    defaultL3ServiceDetails,
    EMPTY_REGISTRY_SLOT_RUNTIME_STATE,
    fieldDefinitionSchema,
    getApi,
    getApiSchema,
    getConfig,
    getConfigSchema,
    getService,
    getServiceSchema,
    getTargetSystemRegistry,
    parseServiceSlot,
    parseServiceSlots,
    patchServiceRuntime,
    postApi,
    postApiSchema,
    postService,
    postServiceInstance,
    postServiceSchema,
    postSystemRegistryConfig,
    postSystemRegistryConfigSchema,
    registerService,
    registerServiceAtStartup,
    registrySlotRuntimePatchFromGuardResult,
    releaseSystemRegistrySlots,
    releaseSystemRegistrySlotsByServiceId,
    resetSystemRegistryConfig,
    resetSystemRegistryConfigSchema,
    resolveActiveRegistryServiceId,
    runRegistrySlotGuardCheck,
    ServiceLifecycleStatus,
    ServiceRegistryError,
    ServiceSlotStatus,
    schemaDefinitionSchema,
    serviceDetailsSchema,
    serviceLifecycleSchema,
    serviceNodeSnapshotSchema,
    serviceRuntimeSchema,
    systemRegistrySeedSlotSchema,
    TARGET_SYSTEM_REGISTRY_KEY,
    unregisterService,
    unregisterServiceAtShutdown,
} from "./service/index";
export type { FetchInitFactory, FetchRetryOptions } from "./shared/http/fetch-retry";
export {
    fetchBinaryWithRetry,
    fetchWithRetry,
    isRetryableHttpStatus,
    requestHasBody,
} from "./shared/http/fetch-retry";
export type {
    CreateLoggerInput,
    DecodedLogBatch,
    FlatLogEntry,
    LogEntry,
    LoggerWithScope,
    LogScope,
    LogScopePatch,
} from "./shared/log";
export {
    createLogger,
    decodeLogBatch,
    decodeLogBatchList,
    flattenLogBatch,
    flattenLogBatches,
    isLogBatchList,
    isLogEntry,
    LOG_BATCH_LOADER_KEY,
    LOG_MIN_LEVEL_ENV_KEY,
    LOG_PERSIST_LOADER_KEY,
    LogLevel,
    logManager,
    logMinLevelFromEnv,
    parseLogBatchMeta,
    resolveLogMinLevel,
} from "./shared/log";
export { isHttpUrl, resolveFetchUrl } from "./shared/utils/fetch-url";
export { getValueAtPath } from "./shared/utils/get-value-at-path";
export type {
    ClassifiedNetworkError,
    FormatNetworkErrorOptions,
    NetworkErrorKind,
} from "./shared/utils/network-error";
export {
    classifyNetworkError,
    formatNetworkError,
} from "./shared/utils/network-error";
export type { SanitizeFileNameOptions } from "./shared/utils/safe-file-name";
export { sanitizeFileName, sanitizeParcelFileName } from "./shared/utils/safe-file-name";
export { sha256Hex } from "./shared/utils/sha256";
export type { SupabaseHolder, SupabaseInitializerParams } from "./supabase";
export { supabase } from "./supabase";
export type {
    PatchChangeTaskStatusPayload,
    PatchClaimTaskPayload,
    PatchTaskProgressPayload,
} from "./task/task.api";
export {
    patchChangeTaskStatus,
    patchChangeTaskStatusSchema,
    patchClaimTask,
    patchClaimTaskSchema,
    patchTaskProgress,
    patchTaskProgressSchema,
} from "./task/task.api";
export type { Task, TaskDetails, TaskFlow } from "./task/task.interface";
// task — api + enqueue only (TaskManager / postTaskWithValidation → node entry)
export {
    CategoryTask,
    ResultCode,
    TaskStatus,
    TaskStatusAction,
} from "./task/task.interface";
export type { PostTaskPayload } from "./task/task-post.api";
export { postTask, postTaskSchema } from "./task/task-post.api";
export type { PostTaskWithRetryOptions, PostTaskWithRetryResult } from "./task/task-post-retry.api";
export { POST_TASK_DEFAULT_MAX_ATTEMPTS, postTaskWithRetry } from "./task/task-post-retry.api";
export type { TaskStatusCount } from "./task/task-queue";
export { countTasksByType, summarizeTaskQueue } from "./task/task-queue";
