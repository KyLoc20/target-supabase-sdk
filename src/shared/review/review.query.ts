import type { QueryFilter } from "../../core.interface";
import { CategoryLink } from "../../link/link.interface";
import { REVIEW_VALUE } from "./review.interface";

/**
 * Filters for review Links with `Link.name === name`.
 * Many rows may match — the SDK does not define dedup for reviews.
 */
export function reviewLinksForNameFilters(name: string): QueryFilter[] {
    const trimmed = name.trim();
    return [
        { field: "category", operator: "eq", value: CategoryLink.LINK },
        { field: "value", operator: "eq", value: REVIEW_VALUE },
        { field: "name", operator: "eq", value: trimmed },
    ];
}
