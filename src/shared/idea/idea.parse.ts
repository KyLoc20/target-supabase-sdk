import type { IdeaOriginal } from "./idea.interface";
import { normalizeStringList } from "./idea.normalize";
import { ideaOriginalSchema } from "./idea.schema";

export function parseIdeaOriginal(original: unknown): IdeaOriginal | null {
    const parsed = ideaOriginalSchema.safeParse(original);
    if (!parsed.success) {
        return null;
    }
    return {
        content: parsed.data.content,
        reviewList: normalizeStringList(parsed.data.reviewList),
        url: parsed.data.url,
        heat: parsed.data.heat,
    };
}
