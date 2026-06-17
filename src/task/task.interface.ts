import { Target } from "../core.interface";
import { Repo } from "../repo/repo.interface";

export enum CategoryTask {
    TASK = "task",
}

export enum TaskStatus {
    OPEN = "OPEN",
    TODO = "TODO",
    DOING = "DOING",
    DONE = "DONE",
    CLOSED = "CLOSED",
}

export enum ResultCode {
    SUCCESS = 1000,

    /** 3xxx 依赖 / 外部 */
    PARAMS_NOT_VALID = 3001,
    REPO_NOT_VALID = 3002,

    /** 4xxx — 运行环境 */
    TIMEOUT = 4001,
    CANCELLED = 4002,
    NODE_UNAVAILABLE = 4003,

    UNKNOWN_ERROR = 9999,
}

export interface Task extends Target {
    /** Readable */
    name: string;
    /** Unique key, as TaskType */
    value: string;
    details: TaskDetails;
    category: CategoryTask;
}

export interface TaskDetails {
    manifestVersion: number;
    status: TaskStatus;
    repo: Repo;
    params: unknown;
    /** [0,100] */
    progress: number;
    nodeId: null | string;
    result?: {
        cost: number;
        code: ResultCode;
        errorMessage?: string;
        data?: unknown;
    }
};

// TODO loop condition combination
export interface TaskFlow extends Target {

}

