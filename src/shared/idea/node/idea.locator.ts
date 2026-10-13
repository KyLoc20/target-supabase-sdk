import { IDEA_IMAGE_TEMP_DIR } from "../idea.interface";

/** Path suffix on upload-service public URL for temp file download. */
export const IDEA_TEMP_DOWNLOAD_PATH_SUFFIX = "/v0/upload/temp/download";

/** Flat path under temp sandbox: `idea/paste/{sha256}.{ext}`. */
export function buildIdeaPasteRelativePath(contentHash: string, ext: string): string {
    const hash = contentHash.trim();
    const extension = ext.trim().replace(/^\./, "");
    if (hash === "" || extension === "") {
        throw new Error("buildIdeaPasteRelativePath: contentHash and ext are required");
    }
    return `${IDEA_IMAGE_TEMP_DIR}/${hash}.${extension}`;
}

function normalizeRelativeSandboxPath(path: string): string | null {
    const normalized = path.replace(/\\/g, "/").trim();
    if (normalized === "" || normalized.startsWith("/") || normalized.includes("..")) {
        return null;
    }
    return normalized;
}

/** Build absolute locator stored in `details.original.url`. */
export function buildIdeaTempDownloadLocator(relativePath: string, publicBaseUrl: string): string {
    const sanitized = normalizeRelativeSandboxPath(relativePath);
    if (sanitized == null) {
        throw new Error("buildIdeaTempDownloadLocator: invalid relativePath");
    }
    const base = publicBaseUrl.trim().replace(/\/+$/, "");
    const url = new URL(`${base}${IDEA_TEMP_DOWNLOAD_PATH_SUFFIX}`);
    url.searchParams.set("path", sanitized);
    return url.href;
}

/** Parse temp download URL → sandbox-relative path, or null when not a temp download URL. */
export function parseIdeaTempDownloadLocator(locator: string): string | null {
    const trimmed = locator.trim();
    if (trimmed === "") {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed, "http://localhost");
    } catch {
        return null;
    }

    const pathname = parsed.pathname.replace(/\\/g, "/");
    if (!pathname.endsWith(IDEA_TEMP_DOWNLOAD_PATH_SUFFIX)) {
        return null;
    }

    const pathParam = parsed.searchParams.get("path");
    if (pathParam == null || pathParam.trim() === "") {
        return null;
    }

    return normalizeRelativeSandboxPath(pathParam.trim());
}
