import { createTarget } from "../core.api";
import { BaseValidator } from "../core.utils";
import { CategoryList, type List, type ListDetails } from "./list.interface";

export interface PostListCreatePayload {
    name: List["name"];
    value: List["value"];
    category: List["category"];
    details: ListDetails;
}

export class PostListValidator extends BaseValidator<PostListCreatePayload> {
    protected requiredFields: (keyof PostListCreatePayload)[] = ["name", "value", "category", "details"];
    protected optionalFields: (keyof PostListCreatePayload)[] = [];

    constructor() {
        super();
        // Add custom
        this.addCustomValidator((_val) => {
            return true;
        });
    }
}

export const postListCreate = async (payload: PostListCreatePayload) => {
    return createTarget<List, PostListCreatePayload>({
        payload: payload,
        validator: PostListValidator,
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

/** Log batch create — idempotent on List.value (stable batch hash). */
export const postLogListCreate = async (payload: PostListCreatePayload) => {
    return createTarget<List, PostListCreatePayload>({
        payload,
        validator: PostListValidator,
        checkRedundancyFilterList: [
            { field: "category", operator: "eq", value: CategoryList.LIST },
            { field: "value", operator: "eq", value: payload.value },
        ],
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
