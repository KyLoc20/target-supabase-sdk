/**
 * Browser-safe public API — no Node.js built-ins (node:fs, node:crypto, …).
 * Default package entry (`target-supabase-sdk`).
 *
 * For TaskManager, RepoManager, TaskNode, use `target-supabase-sdk/node`.
 */

export { SupabaseInitializer } from "./supabase";
export type { SupabaseInitializerParams } from "./supabase";
export type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseInitializer } from "./supabase";

export const supabase = SupabaseInitializer.getInstance();

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

export * from "./service/base.interface";
export * from "./service/service.interface";
export * from "./service/api.interface";

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

export * from "./node/node.interface";
export * from "./node/node.api";

export * from "./repo/repo.interface";
export * from "./repo/repo.api";
