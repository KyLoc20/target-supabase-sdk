import type { QueryFilter } from "../../core.interface";
import { CategoryLink } from "../../link/link.interface";
import { REVIEW_VALUE } from "./review.interface";

/**
 * Filters for all review Links whose subject Target is `refId` (`Link.name === refId`).
 * Many rows may match — the SDK does not define dedup for reviews.
 */
export function reviewLinksForTargetFilters(refId: string): QueryFilter[] {
    const name = refId.trim();
    return [
        { field: "category", operator: "eq", value: CategoryLink.LINK },
        { field: "value", operator: "eq", value: REVIEW_VALUE },
        { field: "name", operator: "eq", value: name },
    ];
}
