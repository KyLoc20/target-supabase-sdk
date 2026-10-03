import { getPossibleTarget, isCreateTargetAlreadyExistsError, postTarget, updateTarget } from "../../../core.api";
import { CategoryLink, type Link, type LinkDetails } from "../../../link/link.interface";
import { createLogger } from "../../log/core/create-logger";
import { isHttpUrl } from "../../utils/fetch-url";
import { buildMediaLinkDraft } from "../media.build";
import { isMediaValue, type MediaValue } from "../media.interface";
import { mediaLinkDedupFilters } from "../media.query";
import { checkMediaAvailability, probeMediaOriginal } from "./media.access";

const logger = createLogger({ module: "media" });

export interface FindMediaLinkInput {
    value: MediaValue;
    name: string;
}

/** Dedup lookup: same `category` + `value` + `name`. */
export async function findMediaLink(input: FindMediaLinkInput): Promise<Link | null> {
    if (!isMediaValue(input.value)) {
        throw new Error(`findMediaLink: unsupported media value: ${String(input.value)}`);
    }
    const name = input.name.trim();
    if (name === "") {
        throw new Error("findMediaLink: name is empty");
    }
    const { data } = await getPossibleTarget({
        filterList: mediaLinkDedupFilters({ value: input.value, name }),
    });
    return data != null ? (data as Link) : null;
}

export interface RegisterMediaLinkInput {
    value: MediaValue;
    name: string;
    storageProvider: string;
    locator: string;
    /** This host id for availability (e.g. `process.env.LOCAL_STORAGE_PROVIDER`). */
    localStorageProvider: string;
    /**
     * Local file to probe when `locator` is http(s) (OSS ingest).
     * Availability uses this path + `localStorageProvider`.
     */
    localLocator?: string;
    description?: string;
    tagList?: string[];
}

export interface RegisterMediaLinkResult {
    id: string;
    created: boolean;
}

function mediaOriginalFromRow(row: { details?: unknown }): { storageProvider?: string; locator?: string } {
    const details = row.details as LinkDetails | undefined;
    const original = details?.original as { storageProvider?: string; locator?: string } | undefined;
    return original ?? {};
}

async function patchMediaOriginal(
    existing: Link,
    storageProvider: string,
    locator: string,
): Promise<RegisterMediaLinkResult> {
    const original = mediaOriginalFromRow(existing);
    if (original.storageProvider === storageProvider && original.locator === locator) {
        return { id: existing.id, created: false };
    }
    await updateTarget({
        id: existing.id,
        optimisticLockFilterList: [
            { field: "category", operator: "eq", value: CategoryLink.LINK },
            { field: "value", operator: "eq", value: existing.value },
        ],
        updateFn: (row) => {
            const details = row.details as LinkDetails;
            const prev = (details.original ?? {}) as Record<string, unknown>;
            return {
                details: {
                    ...details,
                    original: {
                        ...prev,
                        storageProvider,
                        locator,
                    },
                },
            };
        },
    });
    logger.info("media original patched", {
        topic: "register",
        data: { id: existing.id, locator },
    });
    return { id: existing.id, created: false };
}

/**
 * Register a media Link: dedup → availability → probe → `postTarget`.
 * Idempotent when `category`+`value`+`name` already exist (local path).
 * HTTP `locator` + `localLocator`: probe local file, persist remote URL; patch if name exists.
 *
 * **Node-only** — under `shared/media/node/`; do not import from the browser entry.
 */
export async function registerMediaLink(input: RegisterMediaLinkInput): Promise<RegisterMediaLinkResult> {
    if (!isMediaValue(input.value)) {
        throw new Error(`registerMediaLink: unsupported media value: ${String(input.value)}`);
    }
    const name = input.name.trim();
    if (name === "") {
        throw new Error("registerMediaLink: name is empty");
    }

    const storageProvider = input.storageProvider.trim();
    const locator = input.locator.trim();
    const localLocator = input.localLocator?.trim() ?? "";
    const httpLocator = isHttpUrl(locator);

    const existing = await findMediaLink({ value: input.value, name });
    if (existing != null && !httpLocator) {
        logger.info("media already registered", {
            topic: "dedup",
            data: { id: existing.id, value: input.value, name },
        });
        return { id: existing.id, created: false };
    }
    if (existing != null && httpLocator) {
        return patchMediaOriginal(existing, storageProvider, locator);
    }

    const probeStorageProvider = httpLocator ? input.localStorageProvider.trim() : storageProvider;
    const probeLocator = httpLocator ? localLocator : locator;
    if (httpLocator && probeLocator === "") {
        throw new Error("registerMediaLink: localLocator is required when locator is http(s)");
    }

    const availability = await checkMediaAvailability({
        value: input.value,
        storageProvider: probeStorageProvider,
        locator: probeLocator,
        localStorageProvider: input.localStorageProvider,
    });
    if (!availability.ok || availability.absolutePath == null) {
        throw new Error(`registerMediaLink: unavailable — ${availability.reason ?? "unknown"}`);
    }

    const probed = await probeMediaOriginal({
        value: input.value,
        storageProvider: probeStorageProvider,
        locator: probeLocator,
        absolutePath: availability.absolutePath,
    });

    const draft = buildMediaLinkDraft({
        value: input.value,
        name,
        storageProvider: httpLocator ? storageProvider : probed.storageProvider,
        locator: httpLocator ? locator : probed.locator,
        contentHash: probed.contentHash,
        size: probed.size,
        mimeType: probed.mimeType,
        description: input.description,
        tagList: input.tagList,
    });

    try {
        const { data, error } = await postTarget({
            name: draft.name,
            value: draft.value,
            category: draft.category,
            tagList: draft.tagList,
            details: draft.details,
        });
        if (error != null || data == null) {
            throw new Error(error?.message ?? "registerMediaLink: postTarget failed");
        }
        logger.info("media registered", {
            topic: "register",
            data: { id: data.id, value: input.value, name, size: probed.size },
        });
        return { id: data.id, created: true };
    } catch (error) {
        if (isCreateTargetAlreadyExistsError(error)) {
            const raced = await findMediaLink({ value: input.value, name });
            if (raced != null) {
                if (httpLocator) {
                    return patchMediaOriginal(raced, storageProvider, locator);
                }
                logger.info("media register race — using existing", {
                    topic: "dedup",
                    data: { id: raced.id, value: input.value, name },
                });
                return { id: raced.id, created: false };
            }
        }
        throw error;
    }
}
