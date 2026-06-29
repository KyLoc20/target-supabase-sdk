import { createTarget, QueryFilter, updateTargetDetails, validateWithSchema } from "../core.api";
import { generateResponse } from "../core.interface";
import { createApiLogger } from "../shared/log";
import { z } from "zod";
import { CategoryNode, Node, NodeDetails, NodeStatus } from "./node.interface";

const NODE_STATUS_FIELD = "details->>status" as const;

const nodeIdSchema = z.string().trim().min(1);
const traceIdSchema = z.string().trim().min(1).optional();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const postRegisterNodeSchema = z.object({
    traceId: traceIdSchema,
});

export type PostRegisterNodePayload = z.infer<typeof postRegisterNodeSchema>;

export const patchNodeHeartBeatSchema = z.object({
    nodeId: nodeIdSchema,
    traceId: traceIdSchema,
});

export type PatchNodeHeartBeatPayload = z.infer<typeof patchNodeHeartBeatSchema>;

export const patchStopNodeSchema = z.object({
    nodeId: nodeIdSchema,
    traceId: traceIdSchema,
});

export type PatchStopNodePayload = z.infer<typeof patchStopNodeSchema>;

export const patchChangeNodeStatusSchema = z.object({
    nodeId: nodeIdSchema,
    status: z.nativeEnum(NodeStatus),
    /** When set, UPDATE only if current status matches (optimistic lock). */
    fromStatus: z.nativeEnum(NodeStatus).optional(),
    traceId: traceIdSchema,
});

export type PatchChangeNodeStatusPayload = z.infer<typeof patchChangeNodeStatusSchema>;

// ─── Optimistic lock helpers ─────────────────────────────────────────────────

function lockOnNodeStatus(status: NodeStatus): QueryFilter[] {
    return [{ field: NODE_STATUS_FIELD, operator: "eq", value: status }];
}

// ─── postRegisterNode ────────────────────────────────────────────────────────

export const postRegisterNode = validateWithSchema(
    postRegisterNodeSchema,
    "postRegisterNodeSchema"
)(async (payload) => {
    return createTarget<Node, PostRegisterNodePayload>({
        payload,
        createFn: () => {
            const details: NodeDetails = {
                manifestVersion: 0,
                status: NodeStatus.READY,
                lastHeartBeat: Date.now(),
            };
            return {
                name: "",
                category: CategoryNode.NODE,
                value: "",
                tagList: [],
                details,
            };
        },
    });
});

// ─── patchNodeHeartBeat ──────────────────────────────────────────────────────

export const patchNodeHeartBeat = validateWithSchema(
    patchNodeHeartBeatSchema,
    "patchNodeHeartBeatSchema"
)(async ({ nodeId }) => {
    const lastHeartBeat = Date.now();
    await updateTargetDetails<Node, NodeDetails>({
        id: nodeId,
        updateFn: (details) => ({
            ...details,
            lastHeartBeat,
        }),
    });
    return generateResponse.success(lastHeartBeat);
});

// ─── patchStopNode ───────────────────────────────────────────────────────────

export const patchStopNode = validateWithSchema(
    patchStopNodeSchema,
    "patchStopNodeSchema"
)(async ({ nodeId }) => {
    const lastHeartBeat = Date.now();
    // TODO 等待任務全部完成才下綫 應該先使用NodeStatus.DRAINING
    await updateTargetDetails<Node, NodeDetails>({
        id: nodeId,
        updateFn: (details) => ({
            ...details,
            lastHeartBeat,
            status: NodeStatus.LOST,
        }),
    });
    return generateResponse.success(lastHeartBeat);
});

// ─── patchChangeNodeStatus ───────────────────────────────────────────────────

export const patchChangeNodeStatus = validateWithSchema(
    patchChangeNodeStatusSchema,
    "patchChangeNodeStatusSchema"
)(async ({ nodeId, status, fromStatus, traceId }) => {
    const logger = createApiLogger("patchChangeNodeStatus", { traceId, labels: { nodeId } });

    const data = await updateTargetDetails<Node, NodeDetails>({
        id: nodeId,
        optimisticLockFilterList: fromStatus != null ? lockOnNodeStatus(fromStatus) : [],
        updateFn: (details) => ({
            ...details,
            status,
            lastHeartBeat: Date.now(),
        }),
    });

    logger.info("节点状态更新成功", {
        topic: "node",
        data: {
            nodeId,
            status,
            fromStatus,
        },
    });

    return generateResponse.success(data);
});
