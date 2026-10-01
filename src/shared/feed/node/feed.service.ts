import { getTarget, updateTarget } from "../../../core.api";
import type { Target } from "../../../core.interface";
import { CategoryLink, type Link, type LinkDetails } from "../../../link/link.interface";
import { createLogger } from "../../log/core/create-logger";
import { buildFeedTagList, resolveFeedOriginalStorageProvider } from "../feed.build";
import {
    type FeedIngestSource,
    type FeedOriginal,
    type FeedValue,
    isFeedIngestSource,
    isFeedValue,
} from "../feed.interface";
import { checkFeedLocalAvailability, checkFeedOssAvailability } from "./feed.access";

const logger = createLogger({ module: "feed" });

export interface RegisterFeedInput {
    /** Existing feed Link row id (must still be `.public` unless already ingested with same payload). */
    id: string;
    source: FeedIngestSource;
    storageProvider: string;
    locator: string;
    /** Required when `source` is `.local` (e.g. `process.env.LOCAL_STORAGE_PROVIDER`). Ignored for `.oss`. */
    localStorageProvider?: string;
}

export interface RegisterFeedResult {
    id: string;
    /** `false` when row was already ingested with the same source, storageProvider, and locator. */
    updated: boolean;
}

function parseFeedOriginal(original: unknown): FeedOriginal | null {
    if (original == null || typeof original !== "object") {
        return null;
    }
    const record = original as Record<string, unknown>;
    const storageProvider = typeof record.storageProvider === "string" ? record.storageProvider : null;
    const locator = typeof record.locator === "string" ? record.locator : null;
    if (storageProvider == null || locator == null) {
        return null;
    }
    const twinList = Array.isArray(record.twinList)
        ? record.twinList.filter((entry): entry is string => typeof entry === "string")
        : undefined;
    return {
        storageProvider,
        locator,
        ...(twinList !== undefined ? { twinList } : {}),
    };
}

function assertFeedLink(target: Target): Link {
    if (target.category !== CategoryLink.LINK) {
        throw new Error(`registerFeed: target is not a link (category=${target.category})`);
    }
    if (!isFeedValue(target.value)) {
        throw new Error(`registerFeed: target value is not a feed loader: ${target.value}`);
    }
    const details = target.details as LinkDetails | undefined;
    if (details == null || details.loaderKey !== target.value) {
        throw new Error("registerFeed: invalid feed link details (loaderKey must equal value)");
    }
    return target as Link;
}

function hasIngestSourceTag(tagList: string[]): boolean {
    return tagList.some((tag) => tag === ".local" || tag === ".oss");
}

function isSameIngestState(link: Link, source: FeedIngestSource, storageProvider: string, locator: string): boolean {
    if (!link.tagList.includes(source)) {
        return false;
    }
    const original = parseFeedOriginal(link.details.original);
    if (original == null) {
        return false;
    }
    return original.storageProvider === storageProvider && original.locator === locator;
}

/**
 * Ingest a `.public` feed Link: validate locator, then promote `tagList` source to `.local` or `.oss`
 * and update `details.original.storageProvider` + `locator`.
 *
 * **Node-only** — under `shared/feed/node/`; do not import from the browser entry.
 */
export async function registerFeed(input: RegisterFeedInput): Promise<RegisterFeedResult> {
    const id = input.id.trim();
    if (id === "") {
        throw new Error("registerFeed: id is empty");
    }
    if (!isFeedIngestSource(input.source)) {
        throw new Error(`registerFeed: source must be .local or .oss, got ${String(input.source)}`);
    }

    const resolvedStorageProvider = resolveFeedOriginalStorageProvider(input.source, input.storageProvider);
    const locator = input.locator.trim();
    if (locator === "") {
        throw new Error("registerFeed: locator is empty");
    }

    const { data: target } = await getTarget({ id });
    if (target == null) {
        throw new Error(`registerFeed: target not found: ${id}`);
    }

    const link = assertFeedLink(target);
    const feedValue = link.value as FeedValue;

    if (!link.tagList.includes(".public")) {
        if (isSameIngestState(link, input.source, resolvedStorageProvider, locator)) {
            logger.info("feed already ingested", {
                topic: "dedup",
                data: { id, source: input.source, locator },
            });
            return { id, updated: false };
        }
        if (hasIngestSourceTag(link.tagList)) {
            throw new Error("registerFeed: feed already ingested with different source, storageProvider, or locator");
        }
        throw new Error("registerFeed: feed is not .public — cannot ingest");
    }

    if (input.source === ".local") {
        const localStorageProvider = input.localStorageProvider?.trim() ?? "";
        if (localStorageProvider === "") {
            throw new Error("registerFeed: localStorageProvider is required when source is .local");
        }
        const availability = await checkFeedLocalAvailability({
            value: feedValue,
            storageProvider: resolvedStorageProvider,
            locator,
            localStorageProvider,
        });
        if (!availability.ok) {
            throw new Error(`registerFeed: local locator unavailable — ${availability.reason ?? "unknown"}`);
        }
    } else {
        const availability = await checkFeedOssAvailability(locator);
        if (!availability.ok) {
            throw new Error(`registerFeed: oss locator unavailable — ${availability.reason ?? "unknown"}`);
        }
    }

    await updateTarget<Link, LinkDetails>({
        id,
        optimisticLockFilterList: [
            { field: "category", operator: "eq", value: CategoryLink.LINK },
            { field: "details->original->>storageProvider", operator: "eq", value: "" },
        ],
        updateFn: (row) => {
            if (!row.tagList.includes(".public")) {
                throw new Error("registerFeed: optimistic lock failed — .public tag missing");
            }
            if (hasIngestSourceTag(row.tagList) && !row.tagList.includes(".public")) {
                throw new Error("registerFeed: feed already ingested");
            }

            const details = row.details;
            const prior = parseFeedOriginal(details.original);
            const nextOriginal: FeedOriginal = {
                storageProvider: resolvedStorageProvider,
                locator,
                ...(prior?.twinList !== undefined ? { twinList: prior.twinList } : {}),
            };

            return {
                tagList: buildFeedTagList(input.source, row.tagList),
                details: {
                    ...details,
                    original: nextOriginal,
                },
            };
        },
    });

    logger.info("feed ingested", {
        topic: "register",
        data: { id, source: input.source, storageProvider: resolvedStorageProvider, locator },
    });
    return { id, updated: true };
}
