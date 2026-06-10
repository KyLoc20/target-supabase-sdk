import { Target } from "../core.interface";

export enum CategoryIdea {
    OPPORTUNITY = "opportunity",
}

export interface Idea extends Target {
    /** 主題 */
    value: string;
    details: IdeaDetails;
    category: CategoryIdea;
}

export interface IdeaDetails {
    manifestVersion: number;
    marketList: Market[];
    reviewList: string[];
    /** 切入點 */
    point: string;
};

export enum Market {
    NA = "NA",
    EU = "EU",
    JP = "JP",
    CN = "CN",
    TW = "TW",
};