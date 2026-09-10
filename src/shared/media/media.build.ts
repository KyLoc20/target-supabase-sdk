import type { TargetDraft } from "../../core.interface";
import { buildLinkTargetDraft } from "../../link/link.build";
import type { Link } from "../../link/link.interface";
import { isMediaValue, type MediaOriginal, type MediaValue } from "./media.interface";

export interface BuildMediaLinkDraftInput {
    value: MediaValue;
    name: string;
    storageProvider: string;
    locator: string;
    contentHash: string;
    size: number;
    mimeType: string;
    description?: string;
    tagList?: string[];
}

/**
 * Assemble a media {@link Link} draft (`category=link`, `loaderKey === value`).
 * Does not validate filesystem or write to Supabase.
 */
export function buildMediaLinkDraft(input: BuildMediaLinkDraftInput): TargetDraft<Link> {
    if (!isMediaValue(input.value)) {
        throw new Error(`buildMediaLinkDraft: unsupported media value: ${String(input.value)}`);
    }
    const name = input.name.trim();
    if (name === "") {
        throw new Error("buildMediaLinkDraft: name is empty");
    }
    const storageProvider = input.storageProvider.trim();
    if (storageProvider === "") {
        throw new Error("buildMediaLinkDraft: storageProvider is empty");
    }
    const locator = input.locator.trim();
    if (locator === "") {
        throw new Error("buildMediaLinkDraft: locator is empty");
    }
    if (!Number.isFinite(input.size) || input.size < 0) {
        throw new Error("buildMediaLinkDraft: size must be a non-negative number");
    }

    const isList = input.value === "image-list";
    const contentHash = isList ? "" : input.contentHash.trim().toLowerCase();
    const mimeType = isList ? "" : input.mimeType.trim();
    if (!isList && contentHash === "") {
        throw new Error("buildMediaLinkDraft: contentHash is required for single-file media");
    }
    if (!isList && mimeType === "") {
        throw new Error("buildMediaLinkDraft: mimeType is required for single-file media");
    }

    const original: MediaOriginal = {
        storageProvider,
        locator,
        contentHash,
        size: Math.floor(input.size),
        mimeType,
    };

    return buildLinkTargetDraft({
        name,
        value: input.value,
        description: input.description ?? "",
        preview: "",
        loaderKey: input.value,
        tagList: input.tagList ?? [],
        original,
    });
}
