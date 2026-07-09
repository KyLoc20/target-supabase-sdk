/**
 * Log domain public API — curated re-exports only.
 */

export type {
    CreateLoggerFromModuleInput,
    CreateLoggerFromScopeInput,
    CreateLoggerInput,
} from "./create-logger";
// create-logger
export { createLogger } from "./create-logger";
export type { LogEntry, LoggerWithScope, LogOptions, LogRestParams, WithScopeOptions } from "./log-manager";
// log-manager
export { LogLevel, LogManager, logManager } from "./log-manager";
export type {
    CreateScopeInput,
    LoggerResetScopePatch,
    LogScope,
    LogScopeInput,
    LogScopePatch,
    PatchScopeInput,
} from "./log-scope";
// log-scope
export {
    createScope,
    formatScopeLabels,
    normalizeScope,
    patchScope,
    resolveLogData,
    withModule,
} from "./log-scope";
