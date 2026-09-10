/**
 * Node-only media surface — for `src/node.ts` / `target-supabase-sdk/node` only.
 * Never re-export from `../index.ts` or `browser.ts`.
 */

export type { CheckMediaAvailabilityInput, MediaAvailabilityResult } from "./media.access";
export { checkMediaAvailability, probeMediaOriginal } from "./media.access";
export type {
    FindMediaLinkInput,
    RegisterMediaLinkInput,
    RegisterMediaLinkResult,
} from "./media.service";
export { findMediaLink, registerMediaLink } from "./media.service";
