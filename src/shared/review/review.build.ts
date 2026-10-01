import type { TargetDraft } from "../../core.interface";
import { buildLinkTargetDraft } from "../../link/link.build";
import type { Link } from "../../link/link.interface";
import { isReviewValue, REVIEW_VALUE, type ReviewValue } from "./review.interface";

export interface BuildReviewLinkDraftInput {
    /** Must be {@link REVIEW_VALUE}. */
    value: ReviewValue;
    /** Associated Target id — written to `Link.name`. */
    refId: string;
    /** Interaction payload — written to `Link.details.original`. */
    original: unknown;
    tagList?: string[];
    description?: string;
}

/**
 * Assemble a review {@link Link} draft (`category=link`, `loaderKey === value === "review"`).
 * Does not validate `refId` existence or write to Supabase.
 */
export function buildReviewLinkDraft(input: BuildReviewLinkDraftInput): TargetDraft<Link> {
    if (!isReviewValue(input.value)) {
        throw new Error(`buildReviewLinkDraft: unsupported review value: ${String(input.value)}`);
    }
    const refId = input.refId.trim();
    if (refId === "") {
        throw new Error("buildReviewLinkDraft: refId is empty");
    }

    return buildLinkTargetDraft({
        name: refId,
        value: REVIEW_VALUE,
        description: input.description ?? "",
        preview: "",
        loaderKey: REVIEW_VALUE,
        tagList: input.tagList ?? [],
        original: input.original,
    });
}
