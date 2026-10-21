import type { Target } from "../core.interface";

export enum NodeStatus {
    /** Registered, not yet in worker loop. */
    READY = "READY",
    /** Worker main loop is running (accepts tasks until shutdown). */
    BUSY = "BUSY",
    /** Heartbeat lost or voluntarily offline; considered unavailable by the scheduler. */
    LOST = "LOST",
    /** TODO Gracefully draining: not accepting new tasks, waiting for in-flight tasks to complete. */
    DRAINING = "DRAINING",
    /** TODO Disabled by an administrator; excluded from scheduling. */
    DISABLED = "DISABLED",
}

export enum CategoryNode {
    NODE = "node",
}

/** Node role — stored in {@link Node.value}. */
export enum NodeKind {
    TASK = "node.task",
    TRIGGER = "node.trigger",
    GUARD = "node.guard",
    OTHER = "node.other",
}

export interface Node extends Target {
    /** Owning Service instance id (`postService` row id); empty when not bound to a service. */
    name: string;
    /** Node role — {@link NodeKind}. */
    value: string;
    details: NodeDetails;
    category: CategoryNode;
}

export interface NodeDetails {
    manifestVersion: number;
    status: NodeStatus;
    lastHeartBeat: number;
}
