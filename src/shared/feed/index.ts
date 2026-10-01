/**
 * Feed Link — browser-safe public barrel only.
 *
 * Node-only code lives in `./node/` and is exported from `src/node.ts`,
 * never from this file.
 */

export type { BuildFeedLinkDraftInput } from "./feed.build";
export { buildFeedLinkDraft } from "./feed.build";
export type { FeedOriginal, FeedSource, FeedValue } from "./feed.interface";
export { FEED_VALUES, isFeedValue } from "./feed.interface";
export { buildFeedLinkName } from "./feed.name";
export { feedLinkDedupFilters } from "./feed.query";
