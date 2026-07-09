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

export interface Node extends Target {
    /** Empty */
    name: string;
    /** Empty */
    value: string;
    details: NodeDetails;
    category: CategoryNode;
}

export interface NodeDetails {
    manifestVersion: number;
    status: NodeStatus;
    lastHeartBeat: number;
}
