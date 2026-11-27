import { normalizeStringList } from "./idea.normalize";

/**
 * Idea Link lifecycle tags on `tagList` (leading `.` = system tag).
 * Every `value=idea` row must include **at least one** of these.
 */
export const IdeaLifecycleTag = {
    Raw: ".raw",
    Clean: ".clean",
    Curated: ".curated",
} as const;

export type IdeaLifecycleTagValue = (typeof IdeaLifecycleTag)[keyof typeof IdeaLifecycleTag];

/** @deprecated Prefer {@link IdeaLifecycleTag.Raw} */
export const IDEA_IMAGE_TAG_RAW = IdeaLifecycleTag.Raw;

export const IDEA_LIFECYCLE_TAGS: readonly IdeaLifecycleTagValue[] = [
    IdeaLifecycleTag.Raw,
    IdeaLifecycleTag.Clean,
    IdeaLifecycleTag.Curated,
];

const LIFECYCLE_TAG_SET = new Set<string>(IDEA_LIFECYCLE_TAGS);

export function isIdeaLifecycleTag(tag: string): tag is IdeaLifecycleTagValue {
    return LIFECYCLE_TAG_SET.has(tag);
}

export function ideaTagListHasLifecycleTag(tagList: readonly string[]): boolean {
    return tagList.some((tag) => LIFECYCLE_TAG_SET.has(tag));
}

export function assertIdeaTagListHasLifecycleTag(tagList: readonly string[], context: string): void {
    if (!ideaTagListHasLifecycleTag(tagList)) {
        throw new Error(
            `${context}: tagList must include at least one lifecycle tag (${IDEA_LIFECYCLE_TAGS.join(", ")})`,
        );
    }
}

function stripLifecycleTags(tags: readonly string[]): string[] {
    return normalizeStringList(tags).filter((t) => !LIFECYCLE_TAG_SET.has(t));
}

/**
 * Tag list for **new** idea rows (ingest): always `.raw`, plus non-lifecycle extras (e.g. `.oss`).
 * Caller-provided lifecycle tags are ignored on ingest.
 */
export function buildIdeaIngestTagList(extraTags?: readonly string[]): string[] {
    const extras = stripLifecycleTags(extraTags ?? []);
    return normalizeStringList([IdeaLifecycleTag.Raw, ...extras]);
}

/** Normalize `tagList` and require at least one lifecycle tag (updates / assembled drafts). */
export function normalizeIdeaTagList(tagList: readonly string[] | undefined | null, context: string): string[] {
    const normalized = normalizeStringList(tagList);
    if (normalized.length === 0) {
        throw new Error(`${context}: tagList is empty`);
    }
    assertIdeaTagListHasLifecycleTag(normalized, context);
    return normalized;
}
