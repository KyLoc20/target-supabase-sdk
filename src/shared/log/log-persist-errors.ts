const PERMANENT_LOG_PERSIST_ERROR_PATTERNS = [
    /not initialized/i,
    /call initialize\(\) first/i,
    /missing required supabase environment/i,
    /preload env incomplete/i,
];

export function formatLogPersistError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Errors that will not succeed on retry without fixing process configuration. */
export function isPermanentLogPersistError(error: unknown): boolean {
    const message = formatLogPersistError(error);
    return PERMANENT_LOG_PERSIST_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
