import { getPossibleTarget, isCreateTargetAlreadyExistsError, postTarget } from "../../../core.api";
import type { Link } from "../../../link/link.interface";
import { createLogger } from "../../log/core/create-logger";
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
    description?: string;
    tagList?: string[];
}

export interface RegisterMediaLinkResult {
    id: string;
    created: boolean;
}

/**
 * Register a media Link: dedup → availability → probe → `postTarget`.
 * Idempotent when `category`+`value`+`name` already exist.
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

    const existing = await findMediaLink({ value: input.value, name });
    if (existing != null) {
        logger.info("media already registered", {
            topic: "dedup",
            data: { id: existing.id, value: input.value, name },
        });
        return { id: existing.id, created: false };
    }

    const availability = await checkMediaAvailability({
        value: input.value,
        storageProvider: input.storageProvider,
        locator: input.locator,
        localStorageProvider: input.localStorageProvider,
    });
    if (!availability.ok || availability.absolutePath == null) {
        throw new Error(`registerMediaLink: unavailable — ${availability.reason ?? "unknown"}`);
    }

    const probed = await probeMediaOriginal({
        value: input.value,
        storageProvider: input.storageProvider,
        locator: input.locator,
        absolutePath: availability.absolutePath,
    });

    const draft = buildMediaLinkDraft({
        value: input.value,
        name,
        storageProvider: probed.storageProvider,
        locator: probed.locator,
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
