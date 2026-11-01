import { getTargetList, getTargetTotalCount, type QueryFilter, scanTargetList } from "../core.api";
import { CategoryTask, type Task, type TaskDetails, TaskStatus } from "./task.interface";

/** PostgREST column for Task lifecycle (not `details.status`). */
export const TASK_STATUS_FIELD = "status" as const;

const DEFAULT_ACTIVE_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.DOING];

export function taskStatusFilterEq(status: TaskStatus): QueryFilter {
    return { field: TASK_STATUS_FIELD, operator: "eq", value: status };
}

export function taskStatusFilterIn(statuses: readonly TaskStatus[]): QueryFilter {
    if (statuses.length === 1) {
        return taskStatusFilterEq(statuses[0]);
    }
    return { field: TASK_STATUS_FIELD, operator: "in", value: [...statuses] };
}

export function buildTaskQueryFilters(options: {
    value?: string;
    valueIn?: readonly string[];
    status?: TaskStatus;
    statusIn?: readonly TaskStatus[];
}): QueryFilter[] {
    const filterList: QueryFilter[] = [];
    if (options.value != null && options.value !== "") {
        filterList.push({ field: "value", operator: "eq", value: options.value });
    } else if (options.valueIn != null && options.valueIn.length > 0) {
        filterList.push({ field: "value", operator: "in", value: [...options.valueIn] });
    }
    if (options.status != null) {
        filterList.push(taskStatusFilterEq(options.status));
    } else if (options.statusIn != null && options.statusIn.length > 0) {
        filterList.push(taskStatusFilterIn(options.statusIn));
    }
    return filterList;
}

export interface CountTasksParams {
    value?: string;
    valueIn?: readonly string[];
    status?: TaskStatus;
    statusIn?: readonly TaskStatus[];
}

/** Count active `category=task` rows matching optional type and status filters. */
export async function countTasks(params: CountTasksParams): Promise<number> {
    const filterList = buildTaskQueryFilters(params);
    const { data = 0 } = await getTargetTotalCount({
        category: CategoryTask.TASK,
        filterList,
    });
    return data;
}

export interface HasActiveTasksParams {
    value?: string;
    valueIn?: readonly string[];
    /** Defaults to TODO + DOING. */
    statuses?: readonly TaskStatus[];
}

/** True when at least one task row matches (limit-1 probe). */
export async function hasActiveTasks(params: HasActiveTasksParams): Promise<boolean> {
    const statuses = params.statuses ?? DEFAULT_ACTIVE_STATUSES;
    const filterList = buildTaskQueryFilters({
        value: params.value,
        valueIn: params.valueIn,
        statusIn: statuses,
    });
    const { data = [] } = await getTargetList<Task>({
        category: CategoryTask.TASK,
        filterList,
        limit: 1,
        orderBy: { field: "created_at", ascending: true },
    });
    return data.length > 0;
}

export interface ListTasksParams {
    value?: string;
    valueIn?: readonly string[];
    status?: TaskStatus | "all";
    statusIn?: readonly TaskStatus[];
    orderBy?: { field: string; ascending: boolean };
    limit?: number;
    /** When set, scan up to this many rows then slice (legacy gc list cap). */
    maxScan?: number;
}

const MAX_LIST_TASKS = 500;

/** List Task rows via category-scoped scan (filters pushed to PostgREST). */
export async function listTasks(params: ListTasksParams = {}): Promise<Task[]> {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), MAX_LIST_TASKS);
    const status = params.status === "all" ? undefined : params.status;
    const filterList = buildTaskQueryFilters({
        value: params.value,
        valueIn: params.valueIn,
        status,
        statusIn: params.statusIn,
    });
    const orderBy = params.orderBy ?? { field: "created_at", ascending: false };
    const maxRows = params.maxScan != null ? Math.min(Math.max(params.maxScan, limit), MAX_LIST_TASKS) : limit;

    const { data = [] } = await scanTargetList<Task>({
        category: CategoryTask.TASK,
        filterList,
        orderBy,
        maxRows,
    });

    return data.slice(0, limit);
}

/** Stable read model for L3 admin lists (no direct `details.status`). */
export interface TaskSummary {
    id: string;
    name: string;
    value: string;
    status: TaskStatus;
    category: string;
    createdAt: string;
    extra: string | null;
    tagList: string[];
    manifestVersion: number;
    progress: number;
    nodeId: string | null;
    traceId: string | null;
    params: unknown;
    resultCode: number | null;
    errorMessage: string | null;
}

export function taskToSummary(task: Task): TaskSummary {
    const details = task.details as TaskDetails;
    return {
        id: task.id,
        name: task.name,
        value: task.value,
        status: task.status,
        category: task.category,
        createdAt: task.created_at,
        extra: task.extra ?? null,
        tagList: task.tagList ?? [],
        manifestVersion: details.manifestVersion,
        progress: details.progress,
        nodeId: details.nodeId,
        traceId: details.traceId ?? null,
        params: details.params,
        resultCode: details.result?.code ?? null,
        errorMessage: details.result?.errorMessage ?? null,
    };
}
