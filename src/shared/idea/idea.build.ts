import type { TargetDraft } from "../../core.interface";
import { buildLinkTargetDraft } from "../../link/link.build";
import type { Link } from "../../link/link.interface";
import {
    IDEA_IMAGE_LINK_NAME,
    IDEA_IMAGE_TAG_RAW,
    IDEA_LINK_VALUE,
    type IdeaOriginal,
    isIdeaImageLinkName,
} from "./idea.interface";
import { normalizeStringList } from "./idea.normalize";

export interface BuildIdeaLinkDraftInput {
    /** Article title — Link.name (not used for image ideas). */
    name: string;
    /** Body or image content hash — `details.original.content`. */
    content: string;
    reviewList?: readonly string[];
    url?: string;
    heat?: number;
    tagList?: readonly string[];
    description?: string;
    preview?: string;
}

export interface BuildIdeaImageLinkDraftInput {
    /** SHA-256 hex of image bytes — stored in `details.original.content`. */
    contentHash: string;
    /** Temp download or other absolute URL — `details.original.url`. */
    url: string;
    heat?: number;
    tagList?: readonly string[];
    description?: string;
    preview?: string;
}

function resolveIdeaOriginal(input: {
    content: string;
    reviewList?: readonly string[];
    url?: string;
    heat?: number;
}): IdeaOriginal {
    const content = input.content.trim();
    if (content === "") {
        throw new Error("buildIdeaLinkDraft: content is empty");
    }
    if (content.length > 100_000) {
        throw new Error("buildIdeaLinkDraft: content exceeds 100000 characters");
    }

    const url = input.url?.trim() ?? "";
    if (url.length > 2000) {
        throw new Error("buildIdeaLinkDraft: url exceeds 2000 characters");
    }

    const reviewList = normalizeStringList(input.reviewList);
    if (reviewList.length > 32) {
        throw new Error("buildIdeaLinkDraft: reviewList exceeds 32 entries");
    }
    for (const entry of reviewList) {
        if (entry.length > 8000) {
            throw new Error("buildIdeaLinkDraft: reviewList entry exceeds 8000 characters");
        }
    }

    return {
        content,
        reviewList,
        url,
        heat: Math.max(0, Math.floor(input.heat ?? 0)),
    };
}

/**
 * Assemble a text idea {@link Link} draft (`category=link`, `loaderKey === value === "idea"`).
 * Does not write to Supabase or enforce title uniqueness.
 */
export function buildIdeaLinkDraft(input: BuildIdeaLinkDraftInput): TargetDraft<Link> {
    const name = input.name.trim();
    if (name === "") {
        throw new Error("buildIdeaLinkDraft: name is empty");
    }
    if (name.length > 500) {
        throw new Error("buildIdeaLinkDraft: name exceeds 500 characters");
    }
    if (isIdeaImageLinkName(name)) {
        throw new Error("buildIdeaLinkDraft: name is reserved for image ideas; use buildIdeaImageLinkDraft");
    }

    const tagList = normalizeStringList(input.tagList);
    if (tagList.length > 32) {
        throw new Error("buildIdeaLinkDraft: tagList exceeds 32 entries");
    }
    for (const tag of tagList) {
        if (tag.length > 128) {
            throw new Error("buildIdeaLinkDraft: tag exceeds 128 characters");
        }
    }

    const original = resolveIdeaOriginal({
        content: input.content,
        reviewList: input.reviewList,
        url: input.url,
        heat: input.heat,
    });

    return buildLinkTargetDraft({
        name,
        value: IDEA_LINK_VALUE,
        description: input.description ?? "",
        preview: input.preview ?? "",
        loaderKey: IDEA_LINK_VALUE,
        tagList,
        original,
    });
}

/**
 * Assemble a clipboard-image idea Link (`name=idea.image`, `value=idea`).
 * Caller stores bytes and supplies hash + temp URL; no dedup by content hash.
 */
export function buildIdeaImageLinkDraft(input: BuildIdeaImageLinkDraftInput): TargetDraft<Link> {
    const contentHash = input.contentHash.trim();
    if (contentHash === "") {
        throw new Error("buildIdeaImageLinkDraft: contentHash is empty");
    }
    if (contentHash.length > 100_000) {
        throw new Error("buildIdeaImageLinkDraft: contentHash exceeds 100000 characters");
    }

    const url = input.url.trim();
    if (url === "") {
        throw new Error("buildIdeaImageLinkDraft: url is empty");
    }
    if (url.length > 2000) {
        throw new Error("buildIdeaImageLinkDraft: url exceeds 2000 characters");
    }

    const tagList = normalizeStringList(input.tagList ?? [IDEA_IMAGE_TAG_RAW]);
    if (tagList.length === 0) {
        throw new Error("buildIdeaImageLinkDraft: tagList is empty");
    }

    const original: IdeaOriginal = {
        content: contentHash,
        reviewList: [],
        url,
        heat: Math.max(0, Math.floor(input.heat ?? 0)),
    };

    return buildLinkTargetDraft({
        name: IDEA_IMAGE_LINK_NAME,
        value: IDEA_LINK_VALUE,
        description: input.description ?? "",
        preview: input.preview ?? "",
        loaderKey: IDEA_LINK_VALUE,
        tagList,
        original,
    });
}
