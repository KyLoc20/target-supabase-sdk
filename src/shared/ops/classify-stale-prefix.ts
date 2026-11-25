export interface ClassifyStalePrefixOptions<T> {
    staleMs: number;
    now?: number;
    /** Row creation time (ISO string, epoch ms, or Date). Invalid → treat as not stale (stop). */
    getCreatedAt: (row: T) => string | number | Date | null | undefined;
    getId: (row: T) => string;
}

/** Parse created-at-like values to epoch ms, or `NaN` when unusable. */
export function parseCreatedAtMs(value: string | number | Date | null | undefined): number {
    if (value == null) {
        return Number.NaN;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : Number.NaN;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : Number.NaN;
    }
    const trimmed = String(value).trim();
    if (trimmed === "") {
        return Number.NaN;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : Number.NaN;
}

export function isCreatedAtStale(
    createdAt: string | number | Date | null | undefined,
    options: { staleMs: number; now: number },
): boolean {
    const createdMs = parseCreatedAtMs(createdAt);
    if (!Number.isFinite(createdMs)) {
        return false;
    }
    return options.now - createdMs >= options.staleMs;
}

/**
 * From **oldest-first** scan results, collect ids while rows are stale; stop at the first fresh row.
 *
 * Assumes `rows` are ordered ascending by creation time. Used by log-service GC and similar
 * “drain the stale head of a sorted backlog” jobs.
 */
export function classifyStalePrefix<T>(rows: readonly T[], options: ClassifyStalePrefixOptions<T>): string[] {
    const now = options.now ?? Date.now();
    const staleIds: string[] = [];

    for (const row of rows) {
        if (isCreatedAtStale(options.getCreatedAt(row), { staleMs: options.staleMs, now })) {
            staleIds.push(options.getId(row));
        } else {
            break;
        }
    }

    return staleIds;
}
