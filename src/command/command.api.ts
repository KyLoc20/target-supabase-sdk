import {
    createTarget,
    MAX_POLL_TARGET_LIST_SIZE,
    pollTargetList,
    validateWithSchema,
} from "../core.api";
import { generateResponse } from "../core.interface";
import { createApiLogger } from "../shared/log";
import { z } from "zod";
import { CategoryCommand, Command, CommandType } from "./command.interface";

const nodeIdSchema = z.string().trim().min(1);
const traceIdSchema = z.string().trim().min(1).optional();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const postCommandSchema = z.object({
    nodeId: nodeIdSchema,
    command: z.nativeEnum(CommandType),
    traceId: traceIdSchema,
});

export type PostCommandPayload = z.infer<typeof postCommandSchema>;

export const getPollCommandListSchema = z.object({
    nodeId: nodeIdSchema,
    size: z.number().int().min(1).max(MAX_POLL_TARGET_LIST_SIZE).optional(),
    traceId: traceIdSchema,
});

export type GetPollCommandListPayload = z.infer<typeof getPollCommandListSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function commandNodeFilter(nodeId: string) {
    return [{ field: "value", operator: "eq" as const, value: nodeId }];
}

// ─── postCommand ─────────────────────────────────────────────────────────────

/** Enqueue a control command for `nodeId` (scheduler / admin). */
export const postCommand = validateWithSchema(
    postCommandSchema,
    "postCommandSchema"
)(async ({ nodeId, command, traceId }) => {
    const logger = createApiLogger("postCommand", { traceId, labels: { nodeId } });

    const result = await createTarget<Command, PostCommandPayload>({
        payload: { nodeId, command, traceId },
        createFn: () => ({
            name: command,
            value: nodeId,
            category: CategoryCommand.COMMAND,
            tagList: [],
        }),
    });

    logger.info("Command已入隊", {
        topic: "command",
        data: { nodeId, command },
    });

    return result;
});

// ─── getPollCommandList ──────────────────────────────────────────────────────

/** Dequeue control commands for `nodeId` (oldest first). */
export const getPollCommandList = validateWithSchema(
    getPollCommandListSchema,
    "getPollCommandListSchema"
)(async ({ nodeId, size, traceId }) => {
    const logger = createApiLogger("getPollCommandList", { traceId, labels: { nodeId } });

    const { data: dequeuedList = [] } = await pollTargetList<Command>({
        category: CategoryCommand.COMMAND,
        size: size ?? 50,
        filterList: commandNodeFilter(nodeId),
        ascending: true,
    });

    logger.info("Command", {
        topic: "command",
        data: { nodeId, dequeued: dequeuedList.length },
    });

    return generateResponse.success(dequeuedList);
});
