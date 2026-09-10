/**
 * Media Link — browser-safe barrel only.
 *
 * Node-only code lives in `./node/` and is exported from `src/node.ts`,
 * never from this file (see README.md).
 */

export type { BuildMediaLinkDraftInput } from "./media.build";
export { buildMediaLinkDraft } from "./media.build";
export type { MediaOriginal, MediaValue } from "./media.interface";
export {
    isMediaValue,
    MEDIA_CONTENT_HASH_ALGORITHM,
    MEDIA_CONTENT_HASH_PREFIX_LENGTH,
    MEDIA_VALUES,
} from "./media.interface";
export { guessMediaMime } from "./media.mime";
export { buildMediaNameFromLocator } from "./media.name";
export { mediaLinkDedupFilters } from "./media.query";
