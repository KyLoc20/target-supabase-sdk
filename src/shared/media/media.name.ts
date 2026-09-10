import { MEDIA_CONTENT_HASH_PREFIX_LENGTH } from "./media.interface";

/**
 * `{basename}.{hash6}.{ext}` from an absolute (or path-like) locator and full content hash.
 * Does not touch the filesystem.
 */
export function buildMediaNameFromLocator(locator: string, contentHash: string): string {
    const trimmedLocator = locator.trim();
    if (trimmedLocator === "") {
        throw new Error("buildMediaNameFromLocator: locator is empty");
    }
    const hash = contentHash.trim().toLowerCase();
    if (hash.length < MEDIA_CONTENT_HASH_PREFIX_LENGTH) {
        throw new Error(
            `buildMediaNameFromLocator: contentHash must be at least ${MEDIA_CONTENT_HASH_PREFIX_LENGTH} hex chars`,
        );
    }
    const hash6 = hash.slice(0, MEDIA_CONTENT_HASH_PREFIX_LENGTH);

    const normalized = trimmedLocator.replace(/\\/g, "/");
    const base = normalized.split("/").pop() ?? normalized;
    if (base === "" || base === "." || base === "..") {
        throw new Error(`buildMediaNameFromLocator: invalid basename from locator: ${locator}`);
    }

    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) {
        return `${base}.${hash6}`;
    }
    const stem = base.slice(0, dot);
    const ext = base.slice(dot + 1);
    return `${stem}.${hash6}.${ext}`;
}
