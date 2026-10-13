/**
 * Idea Link — browser-safe public barrel only.
 *
 * Node-only code lives in `./node/` and is exported from `src/node.ts`.
 */

export type { BuildIdeaImageLinkDraftInput, BuildIdeaLinkDraftInput } from "./idea.build";
export { buildIdeaImageLinkDraft, buildIdeaLinkDraft } from "./idea.build";
export type { IdeaOriginal } from "./idea.interface";
export {
    IDEA_IMAGE_LINK_NAME,
    IDEA_IMAGE_TAG_RAW,
    IDEA_IMAGE_TEMP_DIR,
    IDEA_LINK_VALUE,
    isIdeaImageLinkName,
} from "./idea.interface";
export { normalizeStringList } from "./idea.normalize";
export { parseIdeaOriginal } from "./idea.parse";
export { ideaLinkValueFilters } from "./idea.query";
export type { IdeaCreateSchemaInput, IdeaUpdateSchemaInput } from "./idea.schema";
export { ideaCreateSchema, ideaUpdateSchema } from "./idea.schema";
