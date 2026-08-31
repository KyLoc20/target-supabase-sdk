/**
 * Log domain public API — curated re-exports only (browser-safe).
 */

export type {
    CreateLoggerFromModuleInput,
    CreateLoggerFromScopeInput,
    CreateLoggerInput,
} from "./core/create-logger";
export { createLogger } from "./core/create-logger";
export type { DecodedLogBatch, FlatLogEntry } from "./core/log-batch";
export {
    decodeLogBatch,
    decodeLogBatchList,
    flattenLogBatch,
    flattenLogBatches,
    isLogBatchList,
    isLogEntry,
    parseLogBatchMeta,
} from "./core/log-batch";
export type { LogEntry, LoggerWithScope, LogOptions, LogRestParams, WithScopeOptions } from "./core/log-manager";
export { LogLevel, LogManager, logManager } from "./core/log-manager";
export type { ResolveLogMinLevelOptions } from "./core/log-min-level";
export {
    LOG_MIN_LEVEL_ENV_KEY,
    logMinLevelFromEnv,
    resolveLogMinLevel,
} from "./core/log-min-level";
export type {
    CreateScopeInput,
    LoggerResetScopePatch,
    LogScope,
    LogScopeInput,
    LogScopePatch,
    PatchScopeInput,
} from "./core/log-scope";
export {
    createScope,
    formatScopeLabels,
    normalizeScope,
    patchScope,
    resolveLogData,
    withModule,
} from "./core/log-scope";
export type { LogBatchMeta, LogPersistLane } from "./upload/interface";
export { LOG_BATCH_LOADER_KEY, LOG_PERSIST_LOADER_KEY } from "./upload/interface";
