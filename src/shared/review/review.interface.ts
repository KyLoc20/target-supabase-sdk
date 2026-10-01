/**
 * Review Link protocol — Link rows with `value` / `loaderKey` === {@link REVIEW_VALUE}.
 * No separate Target category; category remains `link`.
 *
 * A Review records one user interaction with a subject Target (`Link.name` = that Target's id).
 * Many review Links may share the same subject id.
 */

export const REVIEW_VALUE = "review" as const;

/** Discriminator stored in both `Link.value` and `details.loaderKey`. */
export type ReviewValue = typeof REVIEW_VALUE;

/** Caller-defined payload stored in `Link.details.original`. */
export type ReviewOriginal = unknown;

export function isReviewValue(value: string): value is ReviewValue {
    return value === REVIEW_VALUE;
}
