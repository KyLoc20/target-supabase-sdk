import { createRootScope, type LogScope } from "../shared/log";

/** Input for {@link scopeForNodeLoop}. */
export type ScopeForNodeLoopInput = {
    module: string;
    traceId: string;
    nodeId: string;
    traceParentId?: string | null;
};

/** Log scope for one node main-loop iteration (trace + nodeId label). */
export function scopeForNodeLoop(input: ScopeForNodeLoopInput): LogScope {
    const { module, traceId, nodeId, traceParentId = null } = input;
    return createRootScope({ module, traceId, labels: { nodeId }, traceParentId });
}
