import { z } from "zod";
import type { TargetDraft } from "../core.interface";
import { CategoryLink, type Link } from "./link.interface";

export const LINK_MANIFEST_VERSION = 0;

/**
 * Convenience input for {@link buildLinkTargetDraft} — must not include `category`.
 * Also accepted in {@link buildListTargetDraft} `items` as syntactic sugar (see `list.build.ts`).
 */
export interface LinkTargetDraftBuildInput<O = unknown> {
    name: string;
    value: string;
    description: string;
    preview?: string;
    loaderKey: string;
    tagList?: string[];
    original: O;
}

/** Runtime shape check for {@link LinkTargetDraftBuildInput} — `.strict()` rejects `category` and other extra keys. */
export const linkTargetDraftBuildInputSchema = z
    .object({
        name: z.string(),
        value: z.string(),
        description: z.string(),
        preview: z.string().optional(),
        loaderKey: z.string(),
        tagList: z.array(z.string()).optional(),
        original: z.unknown(),
    })
    .strict();

export function buildLinkTargetDraft<O = unknown>(input: LinkTargetDraftBuildInput<O>): TargetDraft<Link> {
    return {
        name: input.name,
        value: input.value,
        category: CategoryLink.LINK,
        tagList: input.tagList ?? [],
        details: {
            manifestVersion: LINK_MANIFEST_VERSION,
            description: input.description,
            preview: input.preview ?? "",
            loaderKey: input.loaderKey,
            original: input.original,
        },
    };
}
