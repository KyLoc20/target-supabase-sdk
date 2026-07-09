export interface SanitizeFileNameOptions {
    /** Max length after sanitization (default 200). */
    maxLength?: number;
    /** When set, used instead of throwing on invalid names. */
    fallback?: string;
}

function fileBaseName(raw: string): string {
    const normalized = raw.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts.at(-1) ?? normalized;
}

/**
 * Safe display / storage file name from a browser or filesystem path string.
 * Strips directory segments and forbidden characters.
 */
export function sanitizeFileName(raw: string, options: SanitizeFileNameOptions = {}): string {
    const maxLength = options.maxLength ?? 200;
    const base = fileBaseName(raw);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strip ASCII control chars (0x00–0x1f)
    const cleaned = base.replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_").trim();

    if (cleaned === "" || cleaned === "." || cleaned === "..") {
        if (options.fallback != null) {
            return options.fallback.slice(0, maxLength);
        }
        throw new Error("Invalid file name");
    }

    return cleaned.slice(0, maxLength);
}

/** Parcel.name / value default — 200 char cap. */
export function sanitizeParcelFileName(raw: string): string {
    return sanitizeFileName(raw, { maxLength: 200 });
}
