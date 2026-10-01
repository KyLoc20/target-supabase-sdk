import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { fetchWithRetry } from "../../http/fetch-retry";
import { isHttpUrl } from "../../utils/fetch-url";
import type { FeedValue } from "../feed.interface";

export interface CheckFeedLocalAvailabilityInput {
    value: FeedValue;
    storageProvider: string;
    locator: string;
    /** This host id (e.g. `process.env.LOCAL_STORAGE_PROVIDER`). */
    localStorageProvider: string;
}

export interface FeedAvailabilityResult {
    ok: boolean;
    /** Absolute path when the locator was resolved on this host. */
    absolutePath?: string;
    reason?: string;
}

function sameStorageHost(storageProvider: string, localStorageProvider: string): boolean {
    return storageProvider.trim() === localStorageProvider.trim();
}

function isFeedDirectoryValue(value: FeedValue): boolean {
    return value === "feed.image-list";
}

/**
 * Local reachability for feed ingest (`.local` source).
 *
 * - Requires `storageProvider === localStorageProvider`.
 * - `locator` must be an absolute path.
 * - `feed.image-list`: directory exists.
 * - Other feed values: non-empty file.
 *
 * **Node-only**
 */
export async function checkFeedLocalAvailability(
    input: CheckFeedLocalAvailabilityInput,
): Promise<FeedAvailabilityResult> {
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
        if (isFeedDirectoryValue(input.value)) {
            if (!info.isDirectory()) {
                return { ok: false, reason: `feed.image-list locator is not a directory: ${absolutePath}` };
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

const OSS_CHECK_TIMEOUT_MS = 15_000;
const OSS_CHECK_MAX_ATTEMPTS = 2;

async function probeHttpLocator(locator: string, method: "HEAD" | "GET"): Promise<Response> {
    return fetchWithRetry(
        locator,
        {
            method,
            ...(method === "GET" ? { headers: { Range: "bytes=0-0" } } : {}),
        },
        {
            label: "feed-oss-check",
            timeoutMs: OSS_CHECK_TIMEOUT_MS,
            maxAttempts: OSS_CHECK_MAX_ATTEMPTS,
        },
    );
}

/**
 * Remote reachability for feed ingest (`.oss` source) via HTTP(S).
 *
 * Tries `HEAD`, then `GET` with `Range: bytes=0-0` when `HEAD` is not allowed.
 *
 * **Node-only**
 */
export async function checkFeedOssAvailability(locator: string): Promise<FeedAvailabilityResult> {
    const trimmed = locator.trim();
    if (trimmed === "") {
        return { ok: false, reason: "locator is empty" };
    }
    if (!isHttpUrl(trimmed)) {
        return { ok: false, reason: `oss locator must be an http(s) URL: ${trimmed}` };
    }

    try {
        let response = await probeHttpLocator(trimmed, "HEAD");
        if (response.status === 405 || response.status === 501) {
            response = await probeHttpLocator(trimmed, "GET");
        }
        if (response.ok || (response.status >= 200 && response.status < 400)) {
            return { ok: true };
        }
        return { ok: false, reason: `oss locator HTTP ${response.status}: ${trimmed}` };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `oss locator request failed: ${trimmed} (${message})` };
    }
}
