import type { Target } from "../core.interface";

export enum CategoryRepo {
    /** Project */
    REPO = "repo",
}

/** `Repo.details.usage` for task worker remote discovery ({@link registerTasks}). */
export const TASK_REPO_USAGE = "task";

export interface Repo extends Target {
    /** Human readable name */
    name: string;
    /** Unique key, consumers use this to determine which repo to use */
    value: string;
    details: RepoDetails;
    category: CategoryRepo;
}

export interface RepoDetails {
    manifestVersion: number;
    /**
     * Business usage partition for discovery and load (caller-defined string, e.g. `"task"`).
     * Used by {@link getScanRemoteRepoValues} to narrow scan scope; validity is the caller's responsibility.
     */
    usage: string;
    /** Repo entry module URL or filesystem path — used to dynamic-import TaskRepoContext. */
    url: string;
    hash: string;
}
