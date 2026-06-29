/**
 * Log domain public API — curated re-exports only.
 */

// log-manager
export { logManager, LogManager, LogLevel } from "./log-manager";
export type { LogEntry, LogOptions, LoggerWithScope, LogRestParams } from "./log-manager";

// create-api-logger
export { createApiLogger } from "./create-api-logger";
export type { CreateApiLoggerOptions } from "./create-api-logger";

// log-scope
export {
    applyScopePatch,
    createChildScope,
    createRootScope,
    formatScopeLabels,
    normalizeScope,
    resolveLogData,
    withModule,
} from "./log-scope";
export type { LogScope, LogScopeInput, LogScopePatch, CreateRootScopeInput, CreateChildScopeInput } from "./log-scope";
