import type { Target } from "../core.interface";

export enum CategoryLink {
    LINK = "link",
}

export interface Link extends Target {
    /** Should be unique */
    name: string;
    /** URL */
    value: string;
    details: LinkDetails;
    /** Only Link can own a custom category, like 'link-log' */
    category: CategoryLink;
}

export interface LinkDetails {
    manifestVersion: number;
    description: string;
    /** If string, it is the url of the preview TODO */
    preview: string;
    /** How to render the link */
    loaderKey: string;
    original: unknown;
}
