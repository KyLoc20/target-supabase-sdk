/**
 * Node-only feed surface — for `src/node.ts` / `target-supabase-sdk/node` only.
 * Never re-export from `../index.ts` or `browser.ts`.
 */

export type { FeedIngestSource } from "../feed.interface";
export { FEED_INGEST_SOURCES, isFeedIngestSource } from "../feed.interface";
export type {
    CheckFeedLocalAvailabilityInput,
    CheckFeedOssAvailabilityOptions,
    FeedAvailabilityResult,
} from "./feed.access";
export { checkFeedLocalAvailability, checkFeedOssAvailability } from "./feed.access";
export type { CreateFeedInput, CreateFeedResult, RegisterFeedInput, RegisterFeedResult } from "./feed.service";
export { createFeed, registerFeed } from "./feed.service";
