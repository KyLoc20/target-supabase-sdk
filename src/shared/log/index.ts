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
export type { DecodedLogBatch, FlatLogEntry } from "./log-batch";
// log-batch (persisted LogBatch decode — read side of log-persist)
export {
    decodeLogBatch,
    decodeLogBatchList,
    flattenLogBatch,
    flattenLogBatches,
    isLogBatchList,
    isLogEntry,
    parseLogBatchMeta,
} from "./log-batch";
export type { LogEntry, LoggerWithScope, LogOptions, LogRestParams, WithScopeOptions } from "./log-manager";
// log-manager
export { LogLevel, LogManager, logManager } from "./log-manager";
export type { LogBatchMeta, LogPersistLane } from "./log-persist.interface";
export { LOG_BATCH_LOADER_KEY, LOG_PERSIST_LOADER_KEY } from "./log-persist.interface";
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
