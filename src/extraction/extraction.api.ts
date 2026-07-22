import { z } from "zod";
import {
    createTarget,
    getPossibleTarget,
    getTarget,
    isCreateTargetAlreadyExistsError,
    type QueryFilter,
    scanTargetList,
    updateTargetDetails,
    validateWithSchema,
} from "../core.api";
import type { SupabaseResponse } from "../core.interface";
import { generateResponse } from "../core.interface";
import { createLogger } from "../shared/log";
import { CategoryExtraction, type Extraction, type ExtractionDetails } from "./extraction.interface";

const targetIdSchema = z.string().trim().min(1);
const loaderKeySchema = z.string().trim().min(1);

export const postExtractionSchema = z.object({
    name: z.string().trim().min(1),
    /** Source Target id — for log analysis this is the producing Task id. */
    sourceId: targetIdSchema,
    loaderKey: loaderKeySchema,
    meta: z.unknown().optional(),
    objects: z.array(z.unknown()).min(1),
    tagList: z.array(z.string()).optional().default([]),
    extra: z.string().optional(),
});

export type PostExtractionPayload = z.infer<typeof postExtractionSchema>;

export const getExtractionSchema = z
    .object({
        id: targetIdSchema.optional(),
        sourceId: targetIdSchema.optional(),
        loaderKey: loaderKeySchema.optional(),
    })
    .refine(
        (payload) => {
            const hasId = payload.id != null && payload.id !== "";
            const hasSource = payload.sourceId != null && payload.sourceId !== "";
            if (hasId) {
                return !hasSource;
            }
            return hasSource && payload.loaderKey != null && payload.loaderKey !== "";
        },
        { message: "Provide id, or both sourceId and loaderKey" },
    );

export type GetExtractionPayload = z.infer<typeof getExtractionSchema>;

export const scanExtractionListSchema = z.object({
    loaderKey: loaderKeySchema.optional(),
    sourceId: targetIdSchema.optional(),
    maxRows: z.number().int().min(1).max(500).optional(),
    ascending: z.boolean().optional(),
});

export type ScanExtractionListPayload = z.infer<typeof scanExtractionListSchema>;

export const patchExtractionObjectsSchema = z.object({
    id: targetIdSchema,
    objects: z.array(z.unknown()).min(1),
    meta: z.unknown().optional(),
    expectedRevision: z.number().int().min(0).optional(),
});

export type PatchExtractionObjectsPayload = z.infer<typeof patchExtractionObjectsSchema>;

const extractionCategoryFilter: QueryFilter = {
    field: "category",
    operator: "eq",
    value: CategoryExtraction.EXTRACTION,
};

function extractionRedundancyFilters(sourceId: string, loaderKey: string): QueryFilter[] {
    return [
        extractionCategoryFilter,
        { field: "value", operator: "eq", value: sourceId },
        { field: "details->>loaderKey", operator: "eq", value: loaderKey },
    ];
}

function normalizeExtractionMeta(meta: unknown, patch?: unknown): Record<string, unknown> {
    const base =
        meta != null && typeof meta === "object" && !Array.isArray(meta)
            ? { ...(meta as Record<string, unknown>) }
            : {};
    if (patch != null && typeof patch === "object" && !Array.isArray(patch)) {
        Object.assign(base, patch as Record<string, unknown>);
    }
    const revision = typeof base.revision === "number" && Number.isInteger(base.revision) ? base.revision : 0;
    base.revision = revision;
    base.updatedAt = new Date().toISOString();
    return base;
}

/** Create an Extraction row for `(sourceId, loaderKey)`. Idempotent on redundancy key. */
export const postExtraction = validateWithSchema(
    postExtractionSchema,
    "postExtractionSchema",
)(async (payload): Promise<SupabaseResponse<Extraction>> => {
    const logger = createLogger({ module: "postExtraction" });
    const meta = normalizeExtractionMeta(payload.meta, { revision: 0 });

    try {
        return await createTarget<Extraction, PostExtractionPayload>({
            payload,
            checkRedundancyFilterList: extractionRedundancyFilters(payload.sourceId, payload.loaderKey),
            createFn: () => ({
                name: payload.name,
                value: payload.sourceId,
                category: CategoryExtraction.EXTRACTION,
                tagList: payload.tagList,
                extra: payload.extra,
                details: {
                    manifestVersion: 0,
                    loaderKey: payload.loaderKey,
                    meta,
                    objects: payload.objects,
                },
            }),
        });
    } catch (error) {
        if (isCreateTargetAlreadyExistsError(error)) {
            logger.warn("Extraction already exists for source + loaderKey", {
                topic: "extraction",
                data: { sourceId: payload.sourceId, loaderKey: payload.loaderKey },
            });
            throw error;
        }
        throw error;
    }
});

/** Fetch one Extraction by row id, or by `(sourceId, loaderKey)`. */
export const getExtraction = validateWithSchema(
    getExtractionSchema,
    "getExtractionSchema",
)(async (payload): Promise<SupabaseResponse<Extraction>> => {
    if (payload.id != null && payload.id !== "") {
        const result = await getTarget({
            id: payload.id,
            filterList: [extractionCategoryFilter],
        });
        return {
            ...result,
            data: result.data as Extraction | undefined,
        };
    }

    const result = await getPossibleTarget({
        filterList: extractionRedundancyFilters(payload.sourceId!, payload.loaderKey!),
    });

    if (result.data == null) {
        return generateResponse.error("Extraction not found", undefined, "NOT_FOUND") as SupabaseResponse<Extraction>;
    }

    return {
        ...result,
        data: result.data as Extraction,
    };
});

/** Scan Extraction rows (newest first by default). */
export const scanExtractionList = validateWithSchema(
    scanExtractionListSchema,
    "scanExtractionListSchema",
)(async (payload) => {
    const filterList: QueryFilter[] = [extractionCategoryFilter];
    if (payload.loaderKey != null) {
        filterList.push({ field: "details->>loaderKey", operator: "eq", value: payload.loaderKey });
    }
    if (payload.sourceId != null) {
        filterList.push({ field: "value", operator: "eq", value: payload.sourceId });
    }

    return scanTargetList<Extraction>({
        category: CategoryExtraction.EXTRACTION,
        filterList,
        maxRows: payload.maxRows ?? 100,
        orderBy: { field: "created_at", ascending: payload.ascending ?? false },
    });
});

/** Replace {@link ExtractionDetails.objects} and bump `meta.revision`. */
export const patchExtractionObjects = validateWithSchema(
    patchExtractionObjectsSchema,
    "patchExtractionObjectsSchema",
)(async (payload): Promise<SupabaseResponse<Extraction>> => {
    const optimisticLockFilterList: QueryFilter[] = [];
    if (payload.expectedRevision != null) {
        optimisticLockFilterList.push({
            field: "details->meta->>revision",
            operator: "eq",
            value: String(payload.expectedRevision),
        });
    }

    try {
        const data = await updateTargetDetails<Extraction, ExtractionDetails>({
            id: payload.id,
            optimisticLockFilterList,
            updateFn: (current) => {
                const currentMeta =
                    current.meta != null && typeof current.meta === "object" && !Array.isArray(current.meta)
                        ? (current.meta as Record<string, unknown>)
                        : {};
                const revision =
                    typeof currentMeta.revision === "number" && Number.isInteger(currentMeta.revision)
                        ? currentMeta.revision + 1
                        : 1;
                return {
                    ...current,
                    meta: normalizeExtractionMeta(current.meta, {
                        ...(payload.meta != null && typeof payload.meta === "object" && !Array.isArray(payload.meta)
                            ? payload.meta
                            : {}),
                        revision,
                    }),
                    objects: payload.objects,
                };
            },
        });
        return generateResponse.success(data as Extraction);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return generateResponse.error(message, undefined, "PATCH_FAILED") as SupabaseResponse<Extraction>;
    }
});
