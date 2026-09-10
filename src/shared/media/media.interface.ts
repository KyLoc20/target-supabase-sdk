/**
 * Media Link protocol — Link rows with value/loaderKey in {@link MEDIA_VALUES}.
 * No separate Target category; category remains `link`.
 */

/** Fixed digest algorithm for single-file media `contentHash`. */
export const MEDIA_CONTENT_HASH_ALGORITHM = "sha256" as const;

/** Hex prefix length for {@link buildMediaNameFromLocator}. */
export const MEDIA_CONTENT_HASH_PREFIX_LENGTH = 6;

export const MEDIA_VALUES = ["video", "audio", "image", "image-list"] as const;

/** Discriminator stored in both `Link.value` and `details.loaderKey`. */
export type MediaValue = (typeof MEDIA_VALUES)[number];

/**
 * `Link.details.original` for media Links.
 *
 * - `locator` — absolute filesystem path, or (future) network URL keyed by `storageProvider`.
 * - `image-list`: `locator` is an absolute directory path; only the **immediate** children
 *   (one level, non-recursive) are counted. `contentHash` and `mimeType` are `""`;
 *   `size` is the number of files in that directory (not bytes).
 * - other values: `size` is byte length; `contentHash` is SHA-256 hex; `mimeType` from the file.
 */
export interface MediaOriginal {
    storageProvider: string;
    locator: string;
    /**
     * SHA-256 hex of file bytes, or `""` when `value === "image-list"`.
     * Algorithm is always {@link MEDIA_CONTENT_HASH_ALGORITHM}.
     */
    contentHash: string;
    /**
     * Single-file media: byte length.
     * `image-list`: number of files in the directory (one level).
     */
    size: number;
    /** e.g. `video/mp4`, or `""` when `value === "image-list"`. */
    mimeType: string;
}

export function isMediaValue(value: string): value is MediaValue {
    return (MEDIA_VALUES as readonly string[]).includes(value);
}
