import type { Target } from "../core.interface";

export enum CategoryList {
    LIST = "list",
}

export interface List extends Target {
    name: string;
    value: string;
    details: ListDetails;
    category: CategoryList;
}

export interface ListDetails {
    manifestVersion: number;
    /** Optional list metadata (shape depends on `loaderKey`). */
    meta: unknown;
    /** If string, it is the url of the preview TODO */
    preview: string;
    /** How to render the List */
    loaderKey: string;
    items: Array<unknown>;
}
