import { getPossibleTarget, QueryFilter, updateTargetDetails, validateWithSchema } from "../core.api";
import { generateResponse } from "../core.interface";
import { createApiLogger, type LoggerWithContext } from "../shared/log/log-manager";
import { z } from "zod";
import { CategoryTask, ResultCode, Task, TaskDetails, TaskStatus, TaskStatusAction } from "./task.interface";

const TASK_STATUS_FIELD = "details->>status" as const;
const TASK_NODE_ID_FIELD = "details->>nodeId" as const;

// ─── State machine ───────────────────────────────────────────────────────────

/**
 * Task state machine (field: `details.status`)
 *
 * ```text
 *   publish          claim (CLAIM / patchClaimTask)     finish
 * OPEN ──────► TODO ──────────────────► DOING ─────────────► DONE
 *   │                │ reset                  │ cancel           │ close
 *   │                │                        └──────► TODO      │
 *   └──────── reset ─┴──────────────────────── reset ────────────┘
 *   |                                                            │
 *   └──────────────────── close ─────────────────────────────────┘
 *                                                               ▼
 *                                                            CLOSED
 * ```
 *
 * | TaskStatusAction | from              | to     | lock filters                   | caller        |
 * |------------------|-------------------|--------|--------------------------------|---------------|
 * | PUBLISH          | OPEN              | TODO   | status = OPEN                  | scheduler     |
 * | CLAIM            | TODO              | DOING  | status = TODO                  | worker        |
 * | RESET            | TODO              | OPEN   | status = TODO (no nodeId)      | admin         |
 * | RESET            | DOING, DONE       | OPEN   | status ∈ {DOING,DONE} + nodeId | worker        |
 * | CANCEL           | DOING             | TODO   | DOING + nodeId                 | worker        |
 * | FINISH           | DOING             | DONE   | DOING + nodeId                 | worker        |
 * | CLOSE            | OPEN, DONE        | CLOSED | status ∈ {OPEN, DONE}          | scheduler     |
 *
 * RESET: omit `nodeId` to reset from **TODO**; pass `nodeId` to reset from **DOING** or **DONE**.
 *
 * All public APIs validate input with Zod (`validateWithSchema`). Optimistic locks live in
 * `optimisticLockFilterList` on UPDATE — see `.cursor/skills/optimistic-lock-update/SKILL.md`.
 */

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const taskIdSchema = z.string().trim().min(1);
const nodeIdSchema = z.string().trim().min(1);
/** Optional — orchestrator (e.g. NodeManager loop) passes its trace to correlate logs. */
const traceIdSchema = z.string().trim().min(1).optional();

const patchChangeTaskStatusBaseSchema = {
    id: taskIdSchema,
    extra: z.string().optional(),
    traceId: traceIdSchema,
};

/** Shared by CLAIM / CANCEL / FINISH — worker-side actions that require nodeId */
const patchChangeTaskStatusNodeOwnedSchema = {
    ...patchChangeTaskStatusBaseSchema,
    nodeId: nodeIdSchema,
};

export const patchChangeTaskStatusSchema = z.discriminatedUnion("action", [
    z.object({
        ...patchChangeTaskStatusBaseSchema,
        action: z.literal(TaskStatusAction.PUBLISH),
    }),
    z.object({
        ...patchChangeTaskStatusBaseSchema,
        action: z.literal(TaskStatusAction.CLOSE),
    }),
    z.object({
        ...patchChangeTaskStatusNodeOwnedSchema,
        action: z.literal(TaskStatusAction.CLAIM),
    }),
    z.object({
        ...patchChangeTaskStatusBaseSchema,
        action: z.literal(TaskStatusAction.RESET),
        nodeId: nodeIdSchema.optional(),
    }),
    z.object({
        ...patchChangeTaskStatusNodeOwnedSchema,
        action: z.literal(TaskStatusAction.CANCEL),
    }),
    z.object({
        ...patchChangeTaskStatusNodeOwnedSchema,
        action: z.literal(TaskStatusAction.FINISH),
        cost: z.number().min(0),
    }),
]);

export type PatchChangeTaskStatusPayload = z.infer<typeof patchChangeTaskStatusSchema>;

export const patchTaskProgressSchema = z.object({
    id: taskIdSchema,
    progress: z.number().min(0).max(100),
    nodeId: nodeIdSchema,
    traceId: traceIdSchema,
});

export type PatchTaskProgressPayload = z.infer<typeof patchTaskProgressSchema>;

export const patchClaimTaskSchema = z.object({
    nodeId: nodeIdSchema,
    availableTaskList: z.array(z.string()).min(1),
    traceId: traceIdSchema,
});

export type PatchClaimTaskPayload = z.infer<typeof patchClaimTaskSchema>;

// ─── Optimistic lock helpers ─────────────────────────────────────────────────

function lockOnStatus(...allowed: TaskStatus[]): QueryFilter[] {
    if (allowed.length === 1) {
        return [{ field: TASK_STATUS_FIELD, operator: "eq", value: allowed[0] }];
    }
    return [{ field: TASK_STATUS_FIELD, operator: "in", value: allowed }];
}

function lockOnOwnerNode(nodeId: string): QueryFilter {
    return { field: TASK_NODE_ID_FIELD, operator: "eq", value: nodeId };
}

/** DOING row owned by `nodeId` — used by FINISH, CANCEL, patchTaskProgress */
function lockOnDoingOwner(nodeId: string): QueryFilter[] {
    return [...lockOnStatus(TaskStatus.DOING), lockOnOwnerNode(nodeId)];
}

/** TODO without nodeId; DOING/DONE with owner when nodeId is provided */
function lockOnReset(nodeId?: string): QueryFilter[] {
    if (nodeId != null) {
        return [...lockOnStatus(TaskStatus.DOING, TaskStatus.DONE), lockOnOwnerNode(nodeId)];
    }
    return lockOnStatus(TaskStatus.TODO);
}

function clearExecutionState(): Pick<TaskDetails, "progress" | "nodeId" | "result"> {
    return { progress: 0, nodeId: null, result: undefined };
}

// ─── Internal transitions ────────────────────────────────────────────────────

async function transitionTask({
    id,
    optimisticLockFilterList,
    updateFn,
    updateExtraFn,
}: {
    id: string;
    optimisticLockFilterList: QueryFilter[];
    updateFn: (details: TaskDetails) => TaskDetails;
    updateExtraFn?: (existing: TaskDetails) => string;
}): Promise<Task> {
    return updateTargetDetails<Task, TaskDetails>({
        id,
        optimisticLockFilterList,
        updateFn,
        updateExtraFn,
    });
}

function logTaskTransition(
    logger: LoggerWithContext,
    action: TaskStatusAction | "patchTaskProgress" | "patchClaimTask",
    task: Task,
    context?: Record<string, unknown>
): void {
    logger.info("任务状态迁移成功", {
        topic: "task",
        context: {
            action,
            taskId: task.id,
            taskValue: task.value,
            status: task.details.status,
            nodeId: task.details.nodeId,
            ...context,
        },
    });
}

/** TODO → DOING — lock status only (no owner yet); used by CLAIM and {@link patchClaimTask} */
async function claimTaskById({
    taskId,
    nodeId,
    updateExtraFn,
}: {
    taskId: string;
    nodeId: string;
    updateExtraFn?: (existing: TaskDetails) => string;
}): Promise<Task> {
    return transitionTask({
        id: taskId,
        optimisticLockFilterList: lockOnStatus(TaskStatus.TODO),
        updateFn: (details) => ({
            ...details,
            status: TaskStatus.DOING,
            nodeId,
        }),
        updateExtraFn,
    });
}

// ─── patchChangeTaskStatus ───────────────────────────────────────────────────

export const patchChangeTaskStatus = validateWithSchema(
    patchChangeTaskStatusSchema,
    "patchChangeTaskStatusSchema"
)(async (params) => {
    const logger = createApiLogger("patchChangeTaskStatus", { traceId: params.traceId });
    const { id, action, extra } = params;
    const updateExtraFn = extra == null ? undefined : () => extra;

    switch (action) {
        case TaskStatusAction.PUBLISH: {
            const data = await transitionTask({
                id,
                optimisticLockFilterList: lockOnStatus(TaskStatus.OPEN),
                updateFn: (details) => ({
                    ...details,
                    ...clearExecutionState(),
                    status: TaskStatus.TODO,
                }),
                updateExtraFn,
            });
            logTaskTransition(logger, action, data);
            return generateResponse.success<Task>(data);
        }
        case TaskStatusAction.CLAIM: {
            const { nodeId } = params;
            const data = await claimTaskById({ taskId: id, nodeId, updateExtraFn });
            logTaskTransition(logger, action, data);
            return generateResponse.success<Task>(data);
        }
        case TaskStatusAction.RESET: {
            const { nodeId } = params;
            const data = await transitionTask({
                id,
                optimisticLockFilterList: lockOnReset(nodeId),
                updateFn: (details) => ({
                    ...details,
                    ...clearExecutionState(),
                    status: TaskStatus.OPEN,
                }),
                updateExtraFn,
            });
            logTaskTransition(logger, action, data, nodeId != null ? undefined : { resetFrom: "TODO" });
            return generateResponse.success<Task>(data);
        }
        case TaskStatusAction.CANCEL: {
            const { nodeId } = params;
            const data = await transitionTask({
                id,
                optimisticLockFilterList: lockOnDoingOwner(nodeId),
                updateFn: (details) => ({
                    ...details,
                    ...clearExecutionState(),
                    status: TaskStatus.TODO,
                }),
                updateExtraFn,
            });
            logTaskTransition(logger, action, data);
            return generateResponse.success<Task>(data);
        }
        case TaskStatusAction.CLOSE: {
            const data = await transitionTask({
                id,
                optimisticLockFilterList: lockOnStatus(TaskStatus.OPEN, TaskStatus.DONE),
                updateFn: (details) => ({
                    ...details,
                    status: TaskStatus.CLOSED,
                }),
                updateExtraFn,
            });
            logTaskTransition(logger, action, data);
            return generateResponse.success<Task>(data);
        }
        case TaskStatusAction.FINISH: {
            const { cost, nodeId } = params;
            const data = await transitionTask({
                id,
                optimisticLockFilterList: lockOnDoingOwner(nodeId),
                updateFn: (details) => ({
                    ...details,
                    progress: 100,
                    status: TaskStatus.DONE,
                    nodeId,
                    result: {
                        cost,
                        code: ResultCode.SUCCESS,
                    },
                }),
                updateExtraFn,
            });
            logTaskTransition(logger, action, data, { cost });
            return generateResponse.success<Task>(data);
        }
        default: {
            const _exhaustive: never = action;
            throw new Error(`[patchChangeTaskStatus] Unknown action: ${_exhaustive}`);
        }
    }
});

// ─── patchTaskProgress ───────────────────────────────────────────────────────

/** Update progress on a DOING task; only the owning node may write (see `lockOnDoingOwner`). */
export const patchTaskProgress = validateWithSchema(
    patchTaskProgressSchema,
    "patchTaskProgressSchema"
)(async ({ id, progress, nodeId, traceId }) => {
    const logger = createApiLogger("patchTaskProgress", { traceId, nodeId });
    const data = await transitionTask({
        id,
        optimisticLockFilterList: lockOnDoingOwner(nodeId),
        updateFn: (details) => ({
            ...details,
            progress,
        }),
    });
    logTaskTransition(logger, "patchTaskProgress", data, { progress });
    return generateResponse.success<Task>(data);
});

// ─── patchClaimTask ──────────────────────────────────────────────────────────

/**
 * Discover and claim one TODO task for this node.
 *
 * Flow: filter by `availableTaskList` → {@link claimTaskById} (same as `action: CLAIM`).
 * Equivalent to `patchChangeTaskStatus({ id, action: CLAIM, nodeId })` when `id` is already known.
 *
 * Returns `data: null` when no TODO task matches. Optimistic lock conflicts propagate as throws
 * (see `.cursor/skills/sdk-error-handling/SKILL.md`).
 */
export const patchClaimTask = validateWithSchema(
    patchClaimTaskSchema,
    "patchClaimTaskSchema"
)(async ({ nodeId, availableTaskList, traceId }) => {
    const logger = createApiLogger("patchClaimTask", { traceId, nodeId });

    const { data: possibleTask } = await getPossibleTarget({
        filterList: [
            { field: "category", operator: "eq", value: CategoryTask.TASK },
            { field: TASK_STATUS_FIELD, operator: "eq", value: TaskStatus.TODO },
            { field: "value", operator: "in", value: availableTaskList },
        ],
    });

    if (possibleTask == null) {
        return generateResponse.success(null);
    }

    const todoTask = possibleTask as Task;
    const data = await claimTaskById({ taskId: todoTask.id, nodeId });
    logTaskTransition(logger, "patchClaimTask", data);
    return generateResponse.success(data);
});
