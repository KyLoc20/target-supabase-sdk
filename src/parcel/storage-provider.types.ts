import type { Parcel } from "./parcel.interface";
import type { StorageAdapter } from "./parcel-manager";
import type { ChunkResolveProvider } from "./chunk-fetch-registry";

export interface ProviderProbeOk {
    ok: true;
    detail?: Record<string, unknown>;
}

export interface ProviderProbeFail {
    ok: false;
    error: string;
}

export type ProviderProbeResult = ProviderProbeOk | ProviderProbeFail;

/** Best-effort rollback of partial uploads. */
export interface UploadTracker<THandle> {
    readonly handles: THandle[];
    push(handle: THandle): void;
}

export interface CreateUploadAdapterOptions {
    /** Collect rollback handles during upload (partial-failure cleanup). */
    tracker?: UploadTracker<unknown>;
}

/** Full storage backend module: upload, restore, probe, rollback. */
export interface StorageProviderModule extends ChunkResolveProvider {
    createUploadAdapter(options?: CreateUploadAdapterOptions): StorageAdapter;
    probe?(): Promise<ProviderProbeResult>;
    rollbackUpload?(handles: unknown[]): Promise<void>;
    /** Validate parcel before restore (provider mix, missing chunks). */
    assertParcelRestorable?(parcel: Parcel): void;
}

export function createUploadTracker<THandle>(): UploadTracker<THandle> {
    const handles: THandle[] = [];
    return {
        handles,
        push(handle: THandle) {
            handles.push(handle);
        },
    };
}
