/**
 * Link domain public API — curated re-exports only.
 */

export type { PostLinkCreatePayload } from "./link.api";
export { PostLinkValidator, postLinkCreate } from "./link.api";
export type { LinkTargetDraftBuildInput } from "./link.build";
export { buildLinkTargetDraft, LINK_MANIFEST_VERSION, linkTargetDraftBuildInputSchema } from "./link.build";
export type { Link, LinkDetails } from "./link.interface";
export { CategoryLink } from "./link.interface";
