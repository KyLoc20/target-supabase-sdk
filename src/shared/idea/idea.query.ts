import type { QueryFilter } from "../../core.interface";
import { CategoryLink } from "../../link/link.interface";
import { IDEA_IMAGE_LINK_NAME, IDEA_LINK_VALUE } from "./idea.interface";

/** List/get filters: `category=link` and `value=idea` (do not filter on `details.loaderKey`). */
export function ideaLinkValueFilters(): QueryFilter[] {
    return [
        { field: "category", operator: "eq", value: CategoryLink.LINK },
        { field: "value", operator: "eq", value: IDEA_LINK_VALUE },
    ];
}

/** Clipboard-image ideas only (`name=idea.image`). */
export function ideaImageLinkFilters(): QueryFilter[] {
    return [...ideaLinkValueFilters(), { field: "name", operator: "eq", value: IDEA_IMAGE_LINK_NAME }];
}
