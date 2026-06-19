import { Target } from "../core.interface";

export enum CategoryRepo {
    /** Project */
    REPO = "repo",
}

export interface Repo extends Target {
    /** Key */
    name: string;
    /** By this key, you can get everything on this repo like source code, which is called RepoContext */
    value: string;
    details: RepoDetails;
    category: CategoryRepo;
}

export interface RepoDetails {
    manifestVersion: number;
    hash: string;
}

