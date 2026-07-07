import { isHttpUrl } from "../shared/utils/fetch-url.js";

export function isLocalFilesystemPath(url: string): boolean {
    if (url.startsWith("file://")) {
        return true;
    }
    return /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("\\\\") || url.startsWith("/");
}

/** Opaque chunk locator — not HTTP and not a local path (e.g. Telegram file_id). */
export function isOpaqueChunkUrl(url: string): boolean {
    return !isHttpUrl(url) && !isLocalFilesystemPath(url);
}

/** `provider:opaque` scheme (e.g. `telegram:BQACAg...`). */
export function parseProviderPrefixedUrl(url: string): { provider: string; locator: string } | null {
    const match = /^([a-z][a-z0-9_-]*):(.+)$/i.exec(url);
    if (match == null) {
        return null;
    }
    const provider = match[1].toLowerCase();
    const locator = match[2].trim();
    if (locator === "") {
        return null;
    }
    if (provider === "http" || provider === "https" || provider === "file") {
        return null;
    }
    return { provider, locator };
}
