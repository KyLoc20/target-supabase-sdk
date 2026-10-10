import type { QueryFilter } from "../../core.interface";
import { linkDedupFilters } from "../../link/link.query";
import type { FeedValue } from "./feed.interface";

/** Dedup key: `category=link` + `value` + `name` (matches register / find). */
export function feedLinkDedupFilters(input: { value: FeedValue; name: string }): QueryFilter[] {
    return linkDedupFilters(input);
}
