import { type Node, NodeStatus } from "./node.interface";

export interface TaskNodeLivenessFreshest {
    nodeId: string;
    status: string;
    lastHeartBeat: string;
    ageMs: number;
}

export interface TaskNodeLivenessReport {
    healthy: boolean;
    staleMs: number;
    /** BUSY nodes with numeric heartbeat after {@link EvaluateBusyNodeLivenessOptions.excludeNodeId}. */
    busyWorkerCount: number;
    /** Subset of candidates with heartbeat age < staleMs. */
    freshWorkerCount: number;
    freshest: TaskNodeLivenessFreshest | null;
}

export interface EvaluateBusyNodeLivenessOptions {
    staleMs: number;
    now?: number;
    /** Omit this node id (e.g. supervisor self). */
    excludeNodeId?: string;
    /**
     * When true, pick freshest only among peers already within staleMs (supervisor spawn guard).
     * When false, pick freshest among all BUSY peers then compare age to staleMs (observability).
     */
    onlyFreshCandidates?: boolean;
}

function isBusyWithHeartbeat(node: Node): boolean {
    return node.details.status === NodeStatus.BUSY && typeof node.details.lastHeartBeat === "number";
}

/** Evaluate TaskNode liveness from a scanned node list (no I/O). */
export function evaluateBusyNodeLiveness(
    nodes: Node[],
    options: EvaluateBusyNodeLivenessOptions,
): TaskNodeLivenessReport {
    const now = options.now ?? Date.now();
    const { staleMs, excludeNodeId, onlyFreshCandidates = false } = options;

    const candidates = nodes.filter(
        (node) => (excludeNodeId == null || node.id !== excludeNodeId) && isBusyWithHeartbeat(node),
    );

    const busyWorkerCount = candidates.length;
    const freshCandidates = candidates.filter((node) => now - node.details.lastHeartBeat < staleMs);
    const freshWorkerCount = freshCandidates.length;

    const pool = onlyFreshCandidates ? freshCandidates : candidates;

    const freshestNode = pool.reduce<Node | null>((best, node) => {
        if (best == null) {
            return node;
        }
        return node.details.lastHeartBeat > best.details.lastHeartBeat ? node : best;
    }, null);

    const ageMs = freshestNode == null ? Number.POSITIVE_INFINITY : now - freshestNode.details.lastHeartBeat;

    const healthy = onlyFreshCandidates ? freshestNode != null : freshestNode != null && ageMs < staleMs;

    return {
        healthy,
        staleMs,
        busyWorkerCount,
        freshWorkerCount,
        freshest:
            freshestNode == null
                ? null
                : {
                      nodeId: freshestNode.id,
                      status: freshestNode.details.status,
                      lastHeartBeat: new Date(freshestNode.details.lastHeartBeat).toISOString(),
                      ageMs,
                  },
    };
}
