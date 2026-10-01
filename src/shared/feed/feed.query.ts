import type { QueryFilter } from "../../core.interface";
import { CategoryLink } from "../../link/link.interface";
import type { FeedValue } from "./feed.interface";

/** Dedup key: `category=link` + `value` + `name` (matches register / find). */
export function feedLinkDedupFilters(input: { value: FeedValue; name: string }): QueryFilter[] {
    const name = input.name.trim();
    return [
        { field: "category", operator: "eq", value: CategoryLink.LINK },
        { field: "value", operator: "eq", value: input.value },
        { field: "name", operator: "eq", value: name },
    ];
}
