import { z } from "zod";
import { createTarget, deleteTarget, getTarget, validateWithSchema } from "../core.api";
import { CategoryParcel, type Parcel, type ParcelDetails } from "./parcel.interface";

const parcelIdSchema = z.string().trim().min(1);

const chunkSchema = z.object({
    index: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    checksum: z.string().trim().min(1),
    url: z.string().trim().min(1),
    provider: z.string().optional(),
});

const parcelCryptoSchema = z.object({
    enabled: z.boolean(),
    algorithm: z.string().optional(),
    iv: z.string().optional(),
    keyDerivation: z.string().optional(),
    salt: z.string().optional(),
    pbkdf2Iterations: z.number().int().positive().optional(),
});

export const parcelDetailsSchema = z.object({
    manifestVersion: z.number().int().nonnegative(),
    chunkList: z.array(chunkSchema).min(1),
    checksum: z.string().trim().min(1),
    size: z.number().int().nonnegative(),
    preview: z.string().optional(),
    crypto: parcelCryptoSchema.optional(),
});

export const postParcelSchema = z.object({
    name: z.string().trim().min(1),
    value: z.string().trim().min(1),
    details: parcelDetailsSchema,
    tagList: z.array(z.string()).optional().default([]),
    extra: z.string().optional(),
});

export type PostParcelPayload = z.infer<typeof postParcelSchema>;

export const getParcelSchema = z.object({
    id: parcelIdSchema,
});

export type GetParcelPayload = z.infer<typeof getParcelSchema>;

export const deleteParcelSchema = z.object({
    id: parcelIdSchema,
});

export type DeleteParcelPayload = z.infer<typeof deleteParcelSchema>;

const parcelCategoryFilter = {
    field: "category",
    operator: "eq" as const,
    value: CategoryParcel.PARCEL,
};

/** Persist a Parcel row (`category=parcel`) after chunks are uploaded via {@link ParcelManager.save}. */
export const postParcel = validateWithSchema(
    postParcelSchema,
    "postParcelSchema",
)(async ({ name, value, details, tagList, extra }) => {
    return createTarget<Parcel, PostParcelPayload>({
        payload: { name, value, details, tagList, extra },
        createFn: () => ({
            name,
            value,
            category: CategoryParcel.PARCEL,
            tagList,
            extra,
            details: details as ParcelDetails,
        }),
    });
});

/** Fetch a Parcel by id (`category=parcel`). */
export const getParcel = validateWithSchema(
    getParcelSchema,
    "getParcelSchema",
)(async ({ id }) => {
    const result = await getTarget({
        id,
        filterList: [parcelCategoryFilter],
    });
    return {
        ...result,
        data: result.data as Parcel,
    };
});

/** Delete a Parcel row by id (`category=parcel`). Does not remove chunk blobs from storage providers. */
export const deleteParcel = validateWithSchema(
    deleteParcelSchema,
    "deleteParcelSchema",
)(async ({ id }) => {
    return deleteTarget({
        id,
        filterList: [parcelCategoryFilter],
    });
});
