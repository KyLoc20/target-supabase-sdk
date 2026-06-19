import logManager, { type LogContext, type LoggerWithContext } from "./log-manager";

/**
 * Options for {@link createApiLogger}.
 *
 * - **Core:** optional `traceId` (generated when omitted)
 * - **Business:** any other {@link LogContext} field (e.g. `nodeId`)
 */
export type CreateApiLoggerOptions = {
    traceId?: string;
} & Partial<Omit<LogContext, "module" | "traceId">>;

/**
 * Logger for one SDK API invocation.
 *
 * Binds required `module` + optional caller `traceId`; business fields (e.g. `nodeId`) are optional.
 */
export function createApiLogger(module: string, options?: CreateApiLoggerOptions): LoggerWithContext {
    const { traceId, ...businessFields } = options ?? {};
    return logManager.withContext({
        module,
        traceId: traceId ?? logManager.generateTraceId(),
        ...businessFields,
    }).logger;
}
