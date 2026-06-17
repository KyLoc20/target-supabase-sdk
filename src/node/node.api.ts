import { CategoryTask, Task, TaskDetails, TaskStatus } from "../task/task.interface";
import { createTarget, getPossibleTarget, updateTargetDetails } from "../core.api";
import { generateResponse } from "../core.interface";
import { BaseValidator } from "../core.utils";
import { CategoryNode, Node, NodeDetails, NodeStatus } from "./node.interface";

export interface PostRegisterNodePayload {
}

export class PostListValidator extends BaseValidator<PostRegisterNodePayload> {
    protected requiredFields: (keyof PostRegisterNodePayload)[] = [];
    protected optionalFields: (keyof PostRegisterNodePayload)[] = [];

    constructor() {
        super();
        // Add custom
        this.addCustomValidator((val) => {
            return true;
        });
    }
}



export const postRegisterNode = async (payload: PostRegisterNodePayload) => {
    return createTarget<Node, PostRegisterNodePayload>({
        payload: payload,
        validator: PostListValidator,
        createFn: (validPayload) => {
            const details: NodeDetails = {
                manifestVersion: 0,
                status: NodeStatus.READY,
                lastHeartBeat: Date.now(),
            };
            return {
                name: '',
                category: CategoryNode.NODE,
                value: '',
                tagList: [],
                details,
            };
        },
    });
};

export const patchNodeHeartBeat = async ({ nodeId }: { nodeId: string }) => {
    const lastHeartBeat = Date.now();
    await updateTargetDetails<Node, NodeDetails>({
        id: nodeId,
        updateFn: (details) => {
            return {
                ...details,
                lastHeartBeat,
            };
        },
    });
    return generateResponse.success(lastHeartBeat);
};

export const patchStopNode = async ({ nodeId }: { nodeId: string }) => {
    const lastHeartBeat = Date.now();
    // TODO 等待任務全部完成才下綫 應該先使用NodeStatus.DRAINING
    await updateTargetDetails<Node, NodeDetails>({
        id: nodeId,
        updateFn: (details) => {
            return {
                ...details,
                lastHeartBeat,
                status: NodeStatus.LOST,
            };
        },
    });
    return generateResponse.success(lastHeartBeat);
};

export interface PatchClaimTaskPayload {
    nodeId: string;
    availableTaskList: string[];
}

/**
 * Atomically claim one TODO task for this node.
 *
 * Flow: find a candidate (TODO + value in availableTaskList) → UPDATE with optimistic lock
 * (status must still be TODO) → return the updated Task row for the executor to run.
 *
 * Returns `data: null` when no TODO task matches. On optimistic lock conflict,
 * `updateTargetDetails` throws — callers may catch `isOptimisticLockError` to retry.
 */
export const patchClaimTask = async ({
    nodeId,
    availableTaskList,
}: PatchClaimTaskPayload) => {
    if (availableTaskList.length === 0) {
        console.log("[patchClaimTask] skipped: availableTaskList is empty", { nodeId });
        return generateResponse.success(null);
    }

    // Step 1: Pick one matching TODO task (not locked; another node may claim the same row next).
    const { data: possibleTask } = await getPossibleTarget({
        filterList: [
            {
                field: "category",
                operator: "eq",
                value: CategoryTask.TASK,
            },
            {
                field: "details->>status",
                operator: "eq",
                value: TaskStatus.TODO,
            },
            {
                field: "value",
                operator: "in",
                value: availableTaskList,
            },
        ],
    });

    if (possibleTask == null) {
        console.log("[patchClaimTask] no TODO task for node capabilities", {
            nodeId,
            availableTaskList,
        });
        return generateResponse.success(null);
    }

    const todoTask = possibleTask as Task;
    console.log("[patchClaimTask] attempting claim", {
        nodeId,
        taskId: todoTask.id,
        taskValue: todoTask.value,
    });

    // Step 2: Claim with DB optimistic lock — UPDATE only if status is still TODO.
    const data = await updateTargetDetails<Task, TaskDetails>({
        id: todoTask.id,
        optimisticLockFilterList: [
            {
                field: "details->>status",
                operator: "eq",
                value: TaskStatus.TODO,
            },
        ],
        updateFn: (details) => ({
            ...details,
            status: TaskStatus.DOING,
            nodeId,
        }),
    });

    console.log("[patchClaimTask] claim succeeded", {
        nodeId,
        taskId: data.id,
        taskValue: data.value,
        status: (data as Task).details.status,
    });

    // Return full updated row so executor can read repo/params without another fetch.
    return generateResponse.success(data);
};
