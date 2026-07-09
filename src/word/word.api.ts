import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import type { Word, WordDetails } from "./word.interface";

export interface PostWordPayload {
    name: Word["name"];
    value: Word["value"];
    category: Word["category"];
    details: WordDetails;
}

export class PostWordValidator extends BaseValidator<PostWordPayload> {
    protected requiredFields: (keyof PostWordPayload)[] = ["name", "value", "category", "details"];
    protected optionalFields: (keyof PostWordPayload)[] = [];

    constructor() {
        super();
        // Add custom
        this.addCustomValidator((_val) => {
            return true;
        });
    }
}

export const postWord = async (payload: PostWordPayload) => {
    return createTarget<Word, PostWordPayload>({
        payload: payload,
        validator: PostWordValidator,
        createFn: (validPayload) => {
            const { name, value, category, details } = validPayload;

            return {
                name,
                category,
                value,
                tagList: [],
                details,
            };
        },
    });
};
