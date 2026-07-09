import { type LoggerWithScope, type LogLevel, logManager } from "./log-manager";
import { createScope, type LogScope, type LogScopePatch } from "./log-scope";

type CreateLoggerLevelOption = {
    /** Overrides global minimum level for this logger only. */
    minLevel?: LogLevel;
};

/** Build scope from fields, then bind a logger. */
export type CreateLoggerFromModuleInput = {
    module: string;
    traceId?: string;
    traceParentId?: string | null;
    labels?: Record<string, string>;
} & CreateLoggerLevelOption;

/** Bind a logger to an existing {@link LogScope}. */
export type CreateLoggerFromScopeInput = {
    scope: LogScope;
} & CreateLoggerLevelOption;

export type CreateLoggerInput = CreateLoggerFromModuleInput | CreateLoggerFromScopeInput;

function isScopeInput(input: CreateLoggerInput): input is CreateLoggerFromScopeInput {
    return "scope" in input;
}

/**
 * Returns a scoped logger — one entry for all call sites.
 *
 * - `{ module, traceId?, labels?, … }` — creates a scope (API handlers, one-shot calls)
 * - `{ scope, minLevel? }` — binds an existing scope (`createScope`, `patchScope`, …)
 */
export function createLogger(input: CreateLoggerInput): LoggerWithScope {
    const { minLevel } = input;
    const scopeOptions = minLevel != null ? { minLevel } : undefined;

    if (isScopeInput(input)) {
        return logManager.withScope(input.scope, scopeOptions).logger;
    }

    const scope = createScope({
        module: input.module,
        traceId: input.traceId?.trim() || logManager.generateTraceId(),
        traceParentId: input.traceParentId,
        labels: input.labels,
    });
    return logManager.withScope(scope, scopeOptions).logger;
}

export type { LogScopePatch };
