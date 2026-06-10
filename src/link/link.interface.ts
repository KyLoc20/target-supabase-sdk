import { Target } from "../core.interface";

export enum CategoryLink {
    LINK = "link",
}

export interface Link extends Target {
    /** 鏈接名稱 */
    name: string;
    /** URL */
    value: string;
    details: LinkDetails;
    category: CategoryLink;
}

export interface LinkDetails {
    manifestVersion: number;
    description: string;
    iconUrl: string;
};

