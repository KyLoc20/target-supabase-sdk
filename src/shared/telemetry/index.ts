/**
 * Telemetry domain public API (browser-safe).
 *
 * Layout:
 *   manager/   — TelemetryManager, createLogger, scope, min-level
 *   call/      — CallEntry recording / withCallTelemetry
 *   transport/ — Supabase fetch + ALS context (Node installs ALS)
 *   persist/   — local dual-lane disk (Node)
 */

export type { RecordCallInput } from "./call/with-call";
export { clipCostMs, recordCall, truncateTelemetryText, withCallTelemetry } from "./call/with-call";
export {
    DEFAULT_TELEMETRY_DIR,
    TELEMETRY_DIR_ENV,
    TELEMETRY_ON_ENV,
    telemetryDirFromEnv,
    telemetryOnFromEnv,
} from "./env";
export type {
    CreateLoggerFromModuleInput,
    CreateLoggerFromScopeInput,
    CreateLoggerInput,
} from "./manager/create-logger";
export { createLogger } from "./manager/create-logger";
export type { ResolveLogMinLevelOptions } from "./manager/log-min-level";
export {
    LOG_MIN_LEVEL_ENV_KEY,
    logMinLevelFromEnv,
    resolveLogMinLevel,
} from "./manager/log-min-level";
export type {
    CreateScopeInput,
    LoggerResetScopePatch,
    LogScope,
    LogScopeInput,
    LogScopePatch,
    PatchScopeInput,
} from "./manager/log-scope";
export {
    createScope,
    formatScopeLabels,
    normalizeScope,
    patchScope,
    resolveLogData,
    withModule,
} from "./manager/log-scope";
export type {
    LogEntry,
    LoggerWithScope,
    LogOptions,
    LogRestParams,
    WithScopeOptions,
} from "./manager/telemetry-manager";
export {
    LogLevel,
    LogManager,
    logManager,
    TelemetryManager,
    telemetryManager,
} from "./manager/telemetry-manager";
export { createSupabaseTelemetryFetch } from "./transport/supabase-telemetry-fetch";
export type {
    CallEntry,
    GcTelemetryInput,
    GcTelemetryResult,
    ListTelemetryBatchesInput,
    ReadTelemetryBatchInput,
    TelemetryBatchFilePayload,
    TelemetryBatchMeta,
    TelemetryLane,
    TelemetryLaneStats,
    TelemetryStats,
} from "./types";
export {
    CALL_ERR_MESSAGE_MAX,
    CALL_EXTRA_MAX,
    CALL_RESULT_SUMMARY_MAX,
    LOG_ENTRY_DATA_JSON_MAX,
    TELEMETRY_SDK_VERSION,
} from "./types";
