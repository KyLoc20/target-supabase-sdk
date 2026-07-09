import type { SupabaseResponse } from "../core.interface";
import { getParcel, postParcel } from "./parcel.api";
import type { Parcel } from "./parcel.interface";
import { type CreateOptions, ParcelManager, type ReassembleOptions, type StorageAdapter } from "./parcel-manager";

export interface PublishParcelInput {
    file: ArrayBuffer;
    adapters: StorageAdapter[];
    name: string;
    value: string;
    tagList?: string[];
    extra?: string;
    createOptions?: CreateOptions;
}

export interface PublishParcelResult {
    parcel: Parcel;
    /** Present when encrypted without passphrase — caller must persist outside Supabase */
    key?: CryptoKey;
}

export interface RestoreParcelByIdInput {
    id: string;
    reassembleOptions?: ReassembleOptions;
}

export interface RestoreParcelByIdResult {
    parcel: Parcel;
    file: ArrayBuffer;
}

function requireResponseData<T>(response: SupabaseResponse<T>, label: string): T {
    if (response.data == null) {
        const suffix = response.message != null ? ` (${response.message})` : "";
        throw new Error(`${label}: no data${suffix}`);
    }
    return response.data;
}

/**
 * One-shot publish: split (optional encrypt) → upload chunks → persist Parcel row.
 * Orchestrates {@link ParcelManager} + {@link postParcel}.
 */
export async function publishParcel(input: PublishParcelInput): Promise<PublishParcelResult> {
    const { file, adapters, name, value, tagList = [], extra, createOptions } = input;

    const createResult = await ParcelManager.create(file, createOptions ?? {});
    const draft = await ParcelManager.save(createResult, adapters, { name, value, tagList });

    const response = await postParcel({
        name: draft.name,
        value: draft.value,
        details: draft.details,
        tagList: draft.tagList ?? [],
        extra,
    });

    return {
        parcel: requireResponseData(response, "postParcel"),
        key: createResult.key,
    };
}

/**
 * Reassemble file bytes from a {@link Parcel} (chunk URLs in details).
 */
export async function restoreParcel(parcel: Parcel, reassembleOptions?: ReassembleOptions): Promise<ArrayBuffer> {
    return ParcelManager.reassemble(parcel, reassembleOptions ?? {});
}

/**
 * Fetch Parcel by id, then reassemble. Orchestrates {@link getParcel} + {@link restoreParcel}.
 */
export async function restoreParcelById(input: RestoreParcelByIdInput): Promise<RestoreParcelByIdResult> {
    const response = await getParcel({ id: input.id });
    const parcel = requireResponseData(response, "getParcel");
    const file = await restoreParcel(parcel, input.reassembleOptions);
    return { parcel, file };
}
