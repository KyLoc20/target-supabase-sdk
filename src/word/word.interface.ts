import type { Target } from "../core.interface";
import type { Link } from "../link/link.interface";

export enum CategoryWord {
    WORD = "word",
}

export interface Word extends Target {
    /** word itself */
    name: string;
    /** word itself */
    value: string;
    details: WordDetails;
    category: CategoryWord;
}

export interface WordDetails {
    manifestVersion: number;
    extensions: string[];
    scope: string;
    reviewList: Array<string | Link>;
}
