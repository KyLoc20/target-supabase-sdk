import type { TargetDraft } from "../../core.interface";
import { buildLinkTargetDraft } from "../../link/link.build";
import type { Link } from "../../link/link.interface";
import { REVIEW_VALUE } from "./review.interface";

export interface BuildReviewLinkDraftInput {
    /** Written to `Link.name` (caller-defined; often a subject Target id). */
    name: string;
    /** Interaction payload — written to `Link.details.original`. */
    original: unknown;
    tagList?: string[];
    description?: string;
}

/**
 * Assemble a review {@link Link} draft (`category=link`, `loaderKey === value === "review"`).
 * Does not validate `name` or write to Supabase.
 */
export function buildReviewLinkDraft(input: BuildReviewLinkDraftInput): TargetDraft<Link> {
    const name = input.name.trim();
    if (name === "") {
        throw new Error("buildReviewLinkDraft: name is empty");
    }

    return buildLinkTargetDraft({
        name,
        value: REVIEW_VALUE,
        description: input.description ?? "",
        preview: "",
        loaderKey: REVIEW_VALUE,
        tagList: input.tagList ?? [],
        original: input.original,
    });
}
