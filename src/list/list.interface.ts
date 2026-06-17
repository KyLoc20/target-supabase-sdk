import { Target, TargetPayload } from "../core.interface";

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
    /** If string, it is the meta brief of the list, TODO */
    meta: string;
    /** If string, it is the url of the preview TODO */
    preview: string;
    /** How to render the List */
    loaderKey: string;
    items: Array<TargetPayload<Target>>
};

