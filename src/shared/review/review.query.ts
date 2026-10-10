import type { QueryFilter } from "../../core.interface";
import { linkDedupFilters } from "../../link/link.query";
import { REVIEW_VALUE } from "./review.interface";

/**
 * Filters for review Links with `Link.name === name`.
 * Many rows may match — the SDK does not define dedup for reviews.
 */
export function reviewLinksForNameFilters(name: string): QueryFilter[] {
    return linkDedupFilters({ value: REVIEW_VALUE, name });
}
