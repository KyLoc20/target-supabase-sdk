/**
 * Browser-safe public API — no Node.js built-ins (node:fs, node:crypto, …).
 * Default package entry (`target-supabase-sdk`).
 *
 * For TaskManager, RepoManager, TaskNode, use `target-supabase-sdk/node`.
 */

export { supabase } from "./supabase";
export type { SupabaseHolder, SupabaseInitializerParams } from "./supabase";
export type { SupabaseClient } from "@supabase/supabase-js";

export * from "./core.api";
export * from "./core.interface";
export * from "./core.utils";
export * from "./idea/idea.interface";

export { CategoryParcel } from "./parcel/parcel.interface";
export type {
	Parcel,
	ParcelDetails,
	ParcelCrypto,
	Chunk,
	LifecycleStatus as ParcelLifecycleStatus,
	Lifecycle as ParcelLifecycle,
} from "./parcel/parcel.interface";
export { ParcelManager } from "./parcel/parcel-manager";
export type { StorageAdapter, ParcelSaveInput, CreateOptions, CreateResult, ReassembleOptions } from "./parcel/parcel-manager";
export {
	postParcel,
	postParcelSchema,
	getParcel,
	getParcelSchema,
	deleteParcel,
	deleteParcelSchema,
	parcelDetailsSchema,
} from "./parcel/parcel.api";
export type { PostParcelPayload, GetParcelPayload, DeleteParcelPayload } from "./parcel/parcel.api";
export {
	publishParcel,
	restoreParcel,
	restoreParcelById,
} from "./parcel/parcel.service";
export type {
	PublishParcelInput,
	PublishParcelResult,
	RestoreParcelByIdInput,
	RestoreParcelByIdResult,
} from "./parcel/parcel.service";

export {
	postApi,
	postApiSchema,
	getApi,
	getApiSchema,
	postService,
	postServiceSchema,
	getService,
	getServiceSchema,
	apiDetailsSchema,
	serviceDetailsSchema,
	serviceLifecycleSchema,
	fieldDefinitionSchema,
	schemaDefinitionSchema,
	discoverService,
	CategoryService,
	ApiMethod,
	ServiceLifecycleStatus,
} from "./service/index";
export type {
	PostApiPayload,
	GetApiPayload,
	PostServicePayload,
	GetServicePayload,
	DiscoverServiceInput,
	Api,
	ApiDetails,
	Service,
	ServiceDetails,
} from "./service/index";

export * from "./link/link.interface";
export * from "./link/link.api";

export * from "./list/list.interface";
export * from "./list/list.api";

export * from "./word/word.interface";

// task — api + validation only (TaskManager is Node-only → node entry)
export {
	CategoryTask,
	ResultCode,
	TaskStatus,
	TaskStatusAction,
} from "./task/task.interface";
export type { Task, TaskDetails, TaskFlow } from "./task/task.interface";
export {
	patchChangeTaskStatus,
	patchChangeTaskStatusSchema,
	patchClaimTask,
	patchClaimTaskSchema,
	patchTaskProgress,
	patchTaskProgressSchema,
} from "./task/task.api";
export type {
	PatchChangeTaskStatusPayload,
	PatchClaimTaskPayload,
	PatchTaskProgressPayload,
} from "./task/task.api";
export { countTasksByType, summarizeTaskQueue } from "./task/task-queue";
export type { TaskStatusCount } from "./task/task-queue";

export * from "./node/node.interface";
export * from "./node/node.api";
export { evaluateBusyNodeLiveness } from "./node/node-liveness";
export type {
	EvaluateBusyNodeLivenessOptions,
	TaskNodeLivenessFreshest,
	TaskNodeLivenessReport,
} from "./node/node-liveness";

export * from "./repo/repo.interface";
export * from "./repo/repo.api";

export { createLogger, logManager, LogLevel } from "./shared/log";
export type { CreateLoggerInput, LoggerWithScope, LogScope, LogScopePatch } from "./shared/log";

export {
	classifyNetworkError,
	formatNetworkError,
} from "./shared/utils/network-error";
export type {
	ClassifiedNetworkError,
	FormatNetworkErrorOptions,
	NetworkErrorKind,
} from "./shared/utils/network-error";

export {
	fetchWithRetry,
	fetchBinaryWithRetry,
	isRetryableHttpStatus,
	requestHasBody,
} from "./shared/http/fetch-retry";
export type { FetchInitFactory, FetchRetryOptions } from "./shared/http/fetch-retry";

export { sha256Hex } from "./shared/utils/sha256";

export { resolveFetchUrl, isHttpUrl } from "./shared/utils/fetch-url";

export {
	isLocalFilesystemPath,
	isOpaqueChunkUrl,
	parseProviderPrefixedUrl,
} from "./parcel/chunk-url.utils";

export { sanitizeFileName, sanitizeParcelFileName } from "./shared/utils/safe-file-name";
export type { SanitizeFileNameOptions } from "./shared/utils/safe-file-name";

export {
	installChunkFetchRegistry,
	registerProviderChunkResolver,
} from "./parcel/chunk-fetch-registry";
export type { ChunkResolveProvider } from "./parcel/chunk-fetch-registry";

export { createStorageProviderRegistry } from "./parcel/storage-provider-registry";
export type { ProviderProbeMap, StorageProviderRegistry } from "./parcel/storage-provider-registry";
export {
	createUploadTracker,
} from "./parcel/storage-provider.types";
export type {
	CreateUploadAdapterOptions,
	ProviderProbeFail,
	ProviderProbeOk,
	ProviderProbeResult,
	StorageProviderModule,
	UploadTracker,
} from "./parcel/storage-provider.types";
