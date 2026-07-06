import { generateUniqueId } from "../utils/id.utils";

/** Logger-bound scope: module + trace chain + optional labels. */
export interface LogScope {
    module: string;
    traceId: string;
    traceParentId: string | null;
    labels?: Readonly<Record<string, string>>;
}

/** Partial update for {@link patchScope}. */
export type LogScopePatch = Partial<Omit<LogScope, "labels">> & {
    labels?: Record<string, string>;
};

/** Fields allowed on {@link LoggerWithScope.resetScope} — no trace identity changes. */
export type LoggerResetScopePatch = {
    module?: string;
    labels?: Record<string, string>;
};

export type LogScopeInput = LogScopePatch & Pick<LogScope, "module">;

interface NormalizeScopeOptions {
    /** When true and traceId is missing, generate a new id. */
    generateTraceId?: boolean;
}

/** Input for {@link patchScope}. */
export type PatchScopeInput = {
    scope: LogScope;
    patch: LogScopePatch;
    /**
     * When `false` (default), `patch.traceId` / `patch.traceParentId` are ignored.
     * New spans: use {@link createScope}.
     */
    allowTraceMutation?: boolean;
};

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

/** Input for {@link createScope}. */
export type CreateScopeInput = {
    module: string;
    traceId: string;
    traceParentId?: string | null;
    labels?: Record<string, string>;
    /** When set, default traceParentId to parent.traceId and merge labels. */
    parent?: LogScope;
};

/** Build a scope; optional parent links trace chain and merges labels. */
export function createScope(input: CreateScopeInput): LogScope {
    const { module, parent, traceId, traceParentId, labels } = input;
    return normalizeScope({
        module,
        traceId,
        traceParentId: traceParentId ?? (parent != null ? parent.traceId : null),
        labels: parent != null ? mergeLabels(parent.labels, labels) : mergeLabels(undefined, labels),
    });
}

/** Merge patch into scope (labels deep-merge). Returns a new scope. */
export function patchScope(input: PatchScopeInput): LogScope {
    const { scope, patch, allowTraceMutation = false } = input;
    const traceId =
        allowTraceMutation && patch.traceId != null && patch.traceId !== ""
            ? patch.traceId
            : scope.traceId;
    const traceParentId =
        allowTraceMutation && patch.traceParentId !== undefined ? patch.traceParentId : scope.traceParentId;

    return normalizeScope({
        module: patch.module ?? scope.module,
        traceId,
        traceParentId,
        labels: mergeLabels(scope.labels, patch.labels),
    });
}

/** Same trace chain, different module (e.g. prepareTask vs executeTask). */
export function withModule(scope: LogScope, module: string): LogScope {
    return patchScope({ scope, patch: { module } });
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
