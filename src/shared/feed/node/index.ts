/**
 * Node-only feed surface — for `src/node.ts` / `target-supabase-sdk/node` only.
 * Never re-export from `../index.ts` or `browser.ts`.
 */

export type { FeedIngestSource } from "../feed.interface";
export { FEED_INGEST_SOURCES, isFeedIngestSource } from "../feed.interface";
export type { CheckFeedLocalAvailabilityInput, FeedAvailabilityResult } from "./feed.access";
export { checkFeedLocalAvailability, checkFeedOssAvailability } from "./feed.access";
export type { RegisterFeedInput, RegisterFeedResult } from "./feed.service";
export { registerFeed } from "./feed.service";
