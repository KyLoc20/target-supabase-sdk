import type { TargetDraft } from "../../core.interface";
import { buildLinkTargetDraft } from "../../link/link.build";
import type { Link } from "../../link/link.interface";
import {
    FEED_SOURCE_TAGS,
    type FeedOriginal,
    type FeedSource,
    type FeedValue,
    isFeedSource,
    isFeedValue,
} from "./feed.interface";
import { buildFeedLinkName } from "./feed.name";

export interface BuildFeedLinkDraftInput {
    value: FeedValue;
    /** Dots are normalized to spaces in {@link buildFeedLinkName} before joining with `feedKey`. */
    platformName: string;
    feedKey: string;
    source: FeedSource;
    locator: string;
    /**
     * Written to `original.storageProvider`. Must be empty when `source` is `.public`;
     * required when `source` is `.local` or `.oss`.
     */
    storageProvider?: string;
    description?: string;
    preview?: string;
    /** Locators for related resources of the same feed; stored on `original.twinList`. */
    twinList?: string[];
    tagList?: string[];
}

/** Trim entries and drop empties; `undefined` when input omitted. */
export function normalizeFeedTwinList(twinList?: string[]): string[] | undefined {
    if (twinList === undefined) {
        return undefined;
    }
    return twinList.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** `original.storageProvider` from optional input and required `source` tier. */
export function resolveFeedOriginalStorageProvider(source: FeedSource, storageProvider?: string): string {
    const trimmed = storageProvider?.trim() ?? "";
    if (source === ".public") {
        if (trimmed !== "") {
            throw new Error("resolveFeedOriginalStorageProvider: storageProvider must be empty when source is .public");
        }
        return "";
    }
    if (trimmed === "") {
        throw new Error(
            "resolveFeedOriginalStorageProvider: storageProvider is required when source is .local or .oss",
        );
    }
    return trimmed;
}

/** Merge user tags with required `source`; strip any other feed source tags from user input. */
export function buildFeedTagList(source: FeedSource, tagList?: string[]): string[] {
    const sourceSet = new Set<string>(FEED_SOURCE_TAGS);
    const user = tagList ?? [];
    const filtered = user.filter((tag) => !sourceSet.has(tag));
    return [...filtered, source];
}

/**
 * Assemble a feed {@link Link} draft (`category=link`, `loaderKey === value`).
 * Does not validate locator reachability or write to Supabase.
 */
export function buildFeedLinkDraft(input: BuildFeedLinkDraftInput): TargetDraft<Link> {
    if (!isFeedValue(input.value)) {
        throw new Error(`buildFeedLinkDraft: unsupported feed value: ${String(input.value)}`);
    }
    if (!isFeedSource(input.source)) {
        throw new Error(`buildFeedLinkDraft: unsupported feed source: ${String(input.source)}`);
    }

    const name = buildFeedLinkName(input.platformName, input.feedKey);
    const locator = input.locator.trim();
    if (locator === "") {
        throw new Error("buildFeedLinkDraft: locator is empty");
    }

    const twinList = normalizeFeedTwinList(input.twinList);
    const storageProvider = resolveFeedOriginalStorageProvider(input.source, input.storageProvider);
    const original: FeedOriginal = {
        storageProvider,
        locator,
        ...(twinList !== undefined ? { twinList } : {}),
    };

    return buildLinkTargetDraft({
        name,
        value: input.value,
        description: input.description ?? "",
        preview: input.preview ?? "",
        loaderKey: input.value,
        tagList: buildFeedTagList(input.source, input.tagList),
        original,
    });
}
