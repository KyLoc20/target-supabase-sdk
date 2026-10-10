import type { QueryFilter } from "../core.interface";
import { CategoryLink } from "./link.interface";

/** Dedup / lookup key: `category=link` + `value` + `name`. */
export type LinkDedupFiltersInput = {
    value: string;
    name: string;
};

/** Shared Link filters used by feed, media, and review query helpers. */
export function linkDedupFilters(input: LinkDedupFiltersInput): QueryFilter[] {
    const name = input.name.trim();
    return [
        { field: "category", operator: "eq", value: CategoryLink.LINK },
        { field: "value", operator: "eq", value: input.value },
        { field: "name", operator: "eq", value: name },
    ];
}
