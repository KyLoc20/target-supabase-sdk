/**
 * Log domain public API — curated re-exports only.
 */

// log-manager
export { logManager, LogManager, LogLevel } from "./log-manager";
export type { LogEntry, LogOptions, LoggerWithScope, LogRestParams, WithScopeOptions } from "./log-manager";

// create-logger
export { createLogger } from "./create-logger";
export type {
    CreateLoggerInput,
    CreateLoggerFromModuleInput,
    CreateLoggerFromScopeInput,
} from "./create-logger";

// log-scope
export {
    patchScope,
    createScope,
    formatScopeLabels,
    normalizeScope,
    resolveLogData,
    withModule,
} from "./log-scope";
export type { LogScope, LogScopeInput, LogScopePatch, LoggerResetScopePatch, PatchScopeInput, CreateScopeInput } from "./log-scope";
