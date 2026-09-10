import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { MEDIA_CONTENT_HASH_ALGORITHM, type MediaOriginal, type MediaValue } from "../media.interface";
import { guessMediaMime } from "../media.mime";

export interface CheckMediaAvailabilityInput {
    value: MediaValue;
    storageProvider: string;
    locator: string;
    /**
     * This host's storage id (e.g. from `LOCAL_STORAGE_PROVIDER`).
     * Local path checks only run when it equals `storageProvider`.
     */
    localStorageProvider: string;
}

export interface MediaAvailabilityResult {
    ok: boolean;
    /** Absolute path when the locator was resolved on this host. */
    absolutePath?: string;
    reason?: string;
}

function sameStorageHost(storageProvider: string, localStorageProvider: string): boolean {
    return storageProvider.trim() === localStorageProvider.trim();
}

async function sha256FileStreaming(absolutePath: string): Promise<string> {
    return await new Promise((resolveHash, reject) => {
        const hash = createHash(MEDIA_CONTENT_HASH_ALGORITHM);
        const stream = createReadStream(absolutePath);
        stream.on("data", (chunk) => {
            hash.update(chunk);
        });
        stream.on("error", reject);
        stream.on("end", () => {
            resolveHash(hash.digest("hex"));
        });
    });
}

async function countFilesOneLevel(dirPath: string): Promise<number> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
        if (entry.isFile()) {
            count += 1;
        }
    }
    return count;
}

/**
 * Fast local reachability check for a media locator.
 *
 * - Requires `storageProvider === localStorageProvider` (cross-host → not ok).
 * - `locator` must be an absolute path.
 * - `image-list`: directory exists; only immediate children are considered.
 * - other values: path exists and is a non-empty file.
 *
 * **Node-only** — under `shared/media/node/`; do not import from the browser entry.
 */
export async function checkMediaAvailability(input: CheckMediaAvailabilityInput): Promise<MediaAvailabilityResult> {
    const storageProvider = input.storageProvider.trim();
    const localStorageProvider = input.localStorageProvider.trim();
    const locator = input.locator.trim();

    if (storageProvider === "" || localStorageProvider === "") {
        return { ok: false, reason: "storageProvider and localStorageProvider are required" };
    }
    if (locator === "") {
        return { ok: false, reason: "locator is empty" };
    }
    if (!sameStorageHost(storageProvider, localStorageProvider)) {
        return {
            ok: false,
            reason: `storageProvider not on this host (${storageProvider} !== ${localStorageProvider})`,
        };
    }
    if (!isAbsolute(locator)) {
        return { ok: false, reason: `locator must be an absolute path: ${locator}` };
    }

    const absolutePath = resolve(locator);

    try {
        const info = await stat(absolutePath);
        if (input.value === "image-list") {
            if (!info.isDirectory()) {
                return { ok: false, reason: `image-list locator is not a directory: ${absolutePath}` };
            }
            return { ok: true, absolutePath };
        }
        if (!info.isFile()) {
            return { ok: false, reason: `locator is not a file: ${absolutePath}` };
        }
        if (info.size <= 0) {
            return { ok: false, reason: `file is empty: ${absolutePath}` };
        }
        return { ok: true, absolutePath };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `locator not reachable: ${absolutePath} (${message})` };
    }
}

/**
 * Derive `contentHash` / `size` / `mimeType` for {@link MediaOriginal} after availability succeeds.
 *
 * **Node-only** — under `shared/media/node/`; do not import from the browser entry.
 */
export async function probeMediaOriginal(input: {
    value: MediaValue;
    storageProvider: string;
    locator: string;
    absolutePath: string;
}): Promise<MediaOriginal> {
    const storageProvider = input.storageProvider.trim();
    const locator = input.locator.trim();

    if (input.value === "image-list") {
        const size = await countFilesOneLevel(input.absolutePath);
        return {
            storageProvider,
            locator,
            contentHash: "",
            size,
            mimeType: "",
        };
    }

    const info = await stat(input.absolutePath);
    const mimeType = guessMediaMime(input.absolutePath, input.value);
    if (mimeType == null) {
        throw new Error(`probeMediaOriginal: cannot guess mimeType for ${input.value}: ${input.absolutePath}`);
    }
    const contentHash = await sha256FileStreaming(input.absolutePath);
    return {
        storageProvider,
        locator,
        contentHash,
        size: info.size,
        mimeType,
    };
}
