import type { QueryFilter } from "../../core.interface";
import { linkDedupFilters } from "../../link/link.query";
import type { MediaValue } from "./media.interface";

/** Dedup key: `category=link` + `value` + `name` (matches register / find). */
export function mediaLinkDedupFilters(input: { value: MediaValue; name: string }): QueryFilter[] {
    return linkDedupFilters(input);
}
