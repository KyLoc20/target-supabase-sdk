import { logManager, type LoggerWithScope } from "./log-manager";
import { normalizeScope, type LogScope, type LogScopePatch } from "./log-scope";

/**
 * Options for {@link createApiLogger}.
 *
 * - **Trace:** optional `traceId` / `traceParentId` (generated root when traceId omitted)
 * - **Labels:** optional `labels` (e.g. `{ nodeId }`)
 */
export type CreateApiLoggerOptions = {
    traceId?: string;
    traceParentId?: string | null;
    labels?: Record<string, string>;
} & Partial<Omit<LogScope, "module" | "traceId" | "traceParentId" | "labels">>;

/**
 * Logger for one SDK API invocation.
 *
 * Binds `module` + normalized {@link LogScope}.
 */
export function createApiLogger(module: string, options?: CreateApiLoggerOptions): LoggerWithScope {
    const { traceId, traceParentId, labels, ...rest } = options ?? {};
    const scope = normalizeScope(
        {
            module,
            traceId,
            traceParentId: traceParentId ?? null,
            labels,
            ...rest,
        },
        { generateTraceId: true }
    );
    return logManager.withScope(scope).logger;
}

export type { LogScopePatch };
