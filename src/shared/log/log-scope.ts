import { generateUniqueId } from "../utils/id.utils";

/** Logger-bound scope: module + trace chain + optional labels. */
export interface LogScope {
    module: string;
    traceId: string;
    traceParentId: string | null;
    labels?: Readonly<Record<string, string>>;
}

/** Partial update for {@link LogScope} / {@link applyScopePatch}. */
export type LogScopePatch = Partial<Omit<LogScope, "labels">> & {
    labels?: Record<string, string>;
    /** @deprecated use labels.nodeId */
    nodeId?: string;
};

export type LogScopeInput = LogScopePatch & Pick<LogScope, "module">;

interface NormalizeScopeOptions {
    /** When true and traceId is missing, generate a new id. */
    generateTraceId?: boolean;
}

function mergeLabels(
    base?: Readonly<Record<string, string>>,
    patch?: Record<string, string>,
    nodeId?: string
): Record<string, string> | undefined {
    const merged: Record<string, string> = { ...base, ...patch };
    const trimmedNodeId = nodeId?.trim();
    if (trimmedNodeId) {
        merged.nodeId = trimmedNodeId;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Coerce partial input into a {@link LogScope}.
 * Legacy `nodeId` merges into `labels.nodeId`.
 */
export function normalizeScope(input: LogScopeInput, options?: NormalizeScopeOptions): LogScope {
    const generateTraceId = options?.generateTraceId ?? false;
    const traceId = input.traceId?.trim() || (generateTraceId ? generateUniqueId() : "");
    if (!traceId) {
        throw new Error("[LogScope] traceId is required (or enable generateTraceId)");
    }

    return {
        module: input.module,
        traceId,
        traceParentId: input.traceParentId ?? null,
        labels: mergeLabels(undefined, input.labels, input.nodeId),
    };
}

/** Root scope: traceParentId defaults to null. */
export function createRootScope(
    module: string,
    traceId?: string,
    labels?: Record<string, string>,
    traceParentId: string | null = null
): LogScope {
    return normalizeScope({ module, traceId, traceParentId, labels }, { generateTraceId: true });
}

/** Child scope: parent link defaults to parent.traceId; labels merge with parent. */
export function createChildScope(
    module: string,
    parent: LogScope,
    options?: {
        traceId?: string;
        traceParentId?: string | null;
        labels?: Record<string, string>;
    }
): LogScope {
    return normalizeScope(
        {
            module,
            traceId: options?.traceId,
            traceParentId: options?.traceParentId ?? parent.traceId,
            labels: mergeLabels(parent.labels, options?.labels),
        },
        { generateTraceId: true }
    );
}

/** Same trace chain, different module (e.g. prepareTask vs executeTask). */
export function withModule(scope: LogScope, module: string): LogScope {
    return { ...scope, module };
}

/** Merge patch into scope (labels deep-merge; legacy nodeId supported). */
export function applyScopePatch(scope: LogScope, patch: LogScopePatch): LogScope {
    return normalizeScope({
        module: patch.module ?? scope.module,
        traceId: patch.traceId ?? scope.traceId,
        traceParentId: patch.traceParentId !== undefined ? patch.traceParentId : scope.traceParentId,
        labels: mergeLabels(scope.labels, patch.labels, patch.nodeId),
    });
}

/** Convenience for node worker loop scopes. */
export function scopeForLoop(
    module: string,
    loopTraceId: string,
    nodeId: string,
    traceParentId: string | null = null
): LogScope {
    return createRootScope(module, loopTraceId, { nodeId }, traceParentId);
}

export function formatScopeLabels(labels?: Readonly<Record<string, string>>): string {
    if (labels == null || Object.keys(labels).length === 0) {
        return "--";
    }
    return Object.entries(labels)
        .map(([key, value]) => `${key}:${value}`)
        .join(",");
}

/** Prefer `data`; fall back to deprecated `context` on log rest params. */
export function resolveLogData(rest?: { data?: unknown; context?: unknown }): unknown | undefined {
    if (rest?.data !== undefined) {
        return rest.data;
    }
    if (rest?.context !== undefined) {
        return rest.context;
    }
    return undefined;
}
