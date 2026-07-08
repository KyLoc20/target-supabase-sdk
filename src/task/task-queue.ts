import { type Task, TaskStatus } from "./task.interface";

export type TaskStatusCount = Partial<Record<TaskStatus, number>>;

/** Count tasks of `taskType` grouped by each requested status. */
export function countTasksByType(
    tasks: Task[],
    taskType: string,
    statuses: TaskStatus[]
): TaskStatusCount {
    const filtered = tasks.filter((task) => task.value === taskType);
    const counts: TaskStatusCount = {};
    for (const status of statuses) {
        counts[status] = filtered.filter((task) => task.details.status === status).length;
    }
    return counts;
}

/** Total tasks of `taskType` whose status is in `statuses`. */
export function summarizeTaskQueue(tasks: Task[], taskType: string, statuses: TaskStatus[]): number {
    return tasks.filter(
        (task) => task.value === taskType && statuses.includes(task.details.status)
    ).length;
}
