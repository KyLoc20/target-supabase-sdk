/**
 * Feed Link protocol — Link rows with value/loaderKey in {@link FEED_VALUES}.
 * No separate Target category; category remains `link`.
 */

export const FEED_VALUES = ["feed.image", "feed.audio", "feed.video", "feed.image-list"] as const;

/** Discriminator stored in both `Link.value` and `details.loaderKey`. */
export type FeedValue = (typeof FEED_VALUES)[number];

/**
 * Feed lifecycle tier — exactly one must appear in `tagList` (via `buildFeedTagList`).
 *
 * Leading `.` marks **system** tags (distinct from user-defined `tagList` entries).
 */
export const FEED_SOURCE_TAGS = [".public", ".local", ".oss"] as const;

export type FeedSource = (typeof FEED_SOURCE_TAGS)[number];

/** `registerFeed` only transitions `.public` → `.local` or `.oss`. */
export const FEED_INGEST_SOURCES = [".local", ".oss"] as const;

export type FeedIngestSource = (typeof FEED_INGEST_SOURCES)[number];

export function isFeedIngestSource(value: string): value is FeedIngestSource {
    return (FEED_INGEST_SOURCES as readonly string[]).includes(value);
}

/** `Link.details.original` for feed Links. */
export interface FeedOriginal {
    /**
     * Backend / host id when {@link FeedSource} is `.local` or `.oss` (e.g. `LOCAL_STORAGE_PROVIDER`).
     * Empty string when source is `.public`.
     */
    storageProvider: string;
    locator: string;
    /**
     * Locators for sibling resources of the same feed (e.g. other media types).
     * Omitted when not supplied on create.
     */
    twinList?: string[];
}

export function isFeedValue(value: string): value is FeedValue {
    return (FEED_VALUES as readonly string[]).includes(value);
}

export function isFeedSource(value: string): value is FeedSource {
    return (FEED_SOURCE_TAGS as readonly string[]).includes(value);
}
