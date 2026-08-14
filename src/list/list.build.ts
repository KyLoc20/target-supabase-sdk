import type { TargetDraft } from "../core.interface";
import {
    buildLinkTargetDraft,
    type LinkTargetDraftBuildInput,
    linkTargetDraftBuildInputSchema,
} from "../link/link.build";
import { CategoryList, type List, type ListDetails } from "./list.interface";

export const LIST_MANIFEST_VERSION = 0;

/**
 * Input for {@link buildListTargetDraft}.
 *
 * `items`: most lists store Link rows. {@link LinkTargetDraftBuildInput} is syntactic
 * sugar — expanded via `buildLinkTargetDraft`. Any other shape is stored as-is.
 */
export type BuildListTargetDraftInput<O = unknown, TCustom = unknown> = {
    loaderKey: string;
    name: string;
    value: string;
    meta?: unknown;
    preview?: string;
    tagList?: string[];
    items: Array<LinkTargetDraftBuildInput<O> | TCustom>;
};

function isLinkTargetDraftBuildInput(item: unknown): item is LinkTargetDraftBuildInput {
    return linkTargetDraftBuildInputSchema.safeParse(item).success;
}

export function buildListTargetDraft<O = unknown, TCustom = unknown>(
    input: BuildListTargetDraftInput<O, TCustom>,
): TargetDraft<List> {
    const items = input.items.map((item) => (isLinkTargetDraftBuildInput(item) ? buildLinkTargetDraft(item) : item));

    const details: ListDetails = {
        manifestVersion: LIST_MANIFEST_VERSION,
        meta: input.meta ?? "",
        preview: input.preview ?? "",
        loaderKey: input.loaderKey,
        items,
    };

    return {
        name: input.name,
        value: input.value,
        category: CategoryList.LIST,
        tagList: input.tagList ?? [],
        details,
    };
}
