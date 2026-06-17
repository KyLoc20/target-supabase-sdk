import { Target } from "../core.interface";

export enum CategoryRepo {
    /** Project */
    REPO = "repo",
    SCRIPT = "script",
}

export interface Repo extends Target {
    /** Key */
    name: string;
    /** Url */
    value: string;
    details: RepoDetails;
    category: CategoryRepo;
}

export interface RepoDetails {
    manifestVersion: number;
    context?: unknown;
    hash: string;
};

