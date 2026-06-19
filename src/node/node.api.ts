import { createTarget, updateTargetDetails } from "../core.api";
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
