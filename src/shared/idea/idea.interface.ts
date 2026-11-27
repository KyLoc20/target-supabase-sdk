/**
 * Idea Link protocol — Link rows with `value` / `loaderKey` === {@link IDEA_LINK_VALUE}.
 * Clipboard images use fixed `name` {@link IDEA_IMAGE_LINK_NAME} (not a separate value).
 */

export const IDEA_LINK_VALUE = "idea" as const;

/** Discriminator stored in both `Link.value` and `details.loaderKey`. */
export type IdeaLinkValue = typeof IDEA_LINK_VALUE;

/** Link.name for clipboard-image ideas (distinct from title-based text ideas). */
export const IDEA_IMAGE_LINK_NAME = "idea.image" as const;

export type { IdeaLifecycleTagValue } from "./idea.lifecycle";
export {
    assertIdeaTagListHasLifecycleTag,
    buildIdeaIngestTagList,
    IDEA_IMAGE_TAG_RAW,
    IDEA_LIFECYCLE_TAGS,
    IdeaLifecycleTag,
    ideaTagListHasLifecycleTag,
    isIdeaLifecycleTag,
    normalizeIdeaTagList,
} from "./idea.lifecycle";

/** Temp sandbox prefix for pasted images (`TEMP_FS_ROOT` on upload-service). */
export const IDEA_IMAGE_TEMP_DIR = "idea/paste" as const;

/** `Link.details.original` for idea Links (text and image). */
export interface IdeaOriginal {
    content: string;
    reviewList: string[];
    url: string;
    heat: number;
}

export function isIdeaLinkValue(value: string): value is IdeaLinkValue {
    return value === IDEA_LINK_VALUE;
}

export function isIdeaImageLinkName(name: string): boolean {
    return name.trim() === IDEA_IMAGE_LINK_NAME;
}
