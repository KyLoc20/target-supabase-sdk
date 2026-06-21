/**
 * Normalize unknown catch / rejection values to {@link Error}.
 *
 * `catch` and Promise rejections are typed `unknown` because `throw` can be
 * anything (string, number, plain object). Call sites that need `.message`,
 * re-throw, or `instanceof Error` checks should normalize first.
 */
export function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

/** Error message safe for log `context` fields (JSON-serializable). */
export function getErrorMessage(value: unknown): string {
    return toError(value).message;
}
