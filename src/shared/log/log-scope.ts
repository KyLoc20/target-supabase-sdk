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
};

export type LogScopeInput = LogScopePatch & Pick<LogScope, "module">;

interface NormalizeScopeOptions {
    /** When true and traceId is missing, generate a new id. */
    generateTraceId?: boolean;
}

function mergeLabels(
    base?: Readonly<Record<string, string>>,
    patch?: Record<string, string>
): Record<string, string> | undefined {
    const merged: Record<string, string> = { ...base, ...patch };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Coerce partial input into a {@link LogScope}. */
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
        labels: mergeLabels(undefined, input.labels),
    };
}

/** Input for {@link createRootScope}. */
export type CreateRootScopeInput = {
    module: string;
    traceId?: string;
    labels?: Record<string, string>;
    traceParentId?: string | null;
};

/** Root scope: traceParentId defaults to null. */
export function createRootScope(input: CreateRootScopeInput): LogScope {
    return normalizeScope(
        {
            module: input.module,
            traceId: input.traceId,
            traceParentId: input.traceParentId ?? null,
            labels: input.labels,
        },
        { generateTraceId: true }
    );
}

/** Input for {@link createChildScope}. */
export type CreateChildScopeInput = {
    module: string;
    parent: LogScope;
    traceId?: string;
    traceParentId?: string | null;
    labels?: Record<string, string>;
};

/** Child scope: parent link defaults to parent.traceId; labels merge with parent. */
export function createChildScope(input: CreateChildScopeInput): LogScope {
    const { module, parent, traceId, traceParentId, labels } = input;
    return normalizeScope(
        {
            module,
            traceId,
            traceParentId: traceParentId ?? parent.traceId,
            labels: mergeLabels(parent.labels, labels),
        },
        { generateTraceId: true }
    );
}

/** Same trace chain, different module (e.g. prepareTask vs executeTask). */
export function withModule(scope: LogScope, module: string): LogScope {
    return { ...scope, module };
}

/** Merge patch into scope (labels deep-merge). */
export function applyScopePatch(scope: LogScope, patch: LogScopePatch): LogScope {
    return normalizeScope({
        module: patch.module ?? scope.module,
        traceId: patch.traceId ?? scope.traceId,
        traceParentId: patch.traceParentId !== undefined ? patch.traceParentId : scope.traceParentId,
        labels: mergeLabels(scope.labels, patch.labels),
    });
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
