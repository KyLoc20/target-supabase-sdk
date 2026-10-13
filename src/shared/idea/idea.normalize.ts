/** Trim, dedupe, and drop empty strings from tag/review lists. */
export function normalizeStringList(raw: readonly string[] | undefined | null): string[] {
    if (raw == null || raw.length === 0) {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
        const text = item.trim();
        if (text === "" || seen.has(text)) {
            continue;
        }
        seen.add(text);
        out.push(text);
    }
    return out;
}
