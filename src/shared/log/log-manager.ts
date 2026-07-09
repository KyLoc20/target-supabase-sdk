import { isDevEnvironment } from "../../core.utils";
import { generateUniqueId } from "../utils/id.utils";
import { formatScopeLabels, type LoggerResetScopePatch, type LogScope, patchScope, resolveLogData } from "./log-scope";

/**
 * Log severity and semantics (low → high). `minLevel` filters by {@link LOG_LEVEL_RANK}.
 *
 * | Level    | Rank | When to use |
 * |----------|------|-------------|
 * | DEBUG    | 0    | Diagnostic detail for dev/troubleshooting; noisy, safe to drop in prod. |
 * | INFO     | 1    | Normal operational flow (startup, polling, state transitions). |
 * | SUCCESS  | 2    | Positive milestone within a flow (not a separate severity axis — same band as INFO). |
 * | WARN     | 3    | Recoverable anomaly or degradation; work continues but worth watching. |
 * | ERROR    | 4    | A concrete operation failed (API, task step, I/O); investigate and retry/fix locally. |
 * | CRITICAL | 5    | Invariant violated — design flaw, data-integrity risk, or business rule broken; escalate and fix urgently. |
 */
enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    SUCCESS = "SUCCESS",
    WARN = "WARN",
    ERROR = "ERROR",
    CRITICAL = "CRITICAL",
}

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.SUCCESS]: 2,
    [LogLevel.WARN]: 3,
    [LogLevel.ERROR]: 4,
    [LogLevel.CRITICAL]: 5,
};

interface LogEntry extends LogScope {
    timestamp: number;
    level: LogLevel;
    message: string;
    topic: string;
    extra?: string;
    /** Per-line structured business payload. */
    data?: unknown;
}

type LogRestParams = {
    topic: string;
    extra?: LogEntry["extra"];
    data?: unknown;
};

type LogParams = { message: LogEntry["message"] } & LogRestParams;

interface LogEntryPayload extends LogScope {
    message: LogEntry["message"];
    topic: LogEntry["topic"];
    extra?: LogEntry["extra"];
    data?: LogEntry["data"];
    level: LogEntry["level"];
}

interface LogOptions {
    formatTimestamp: boolean;
    formatEmoji: boolean;
    formatPrefix: string;
    /** Logs below this level are skipped. Defaults to DEBUG in dev, INFO in production. */
    minLevel?: LogLevel;
    onLog?: (entry: LogEntry) => void;
}

/** Per-scoped-logger options for {@link LogManager.withScope}. */
interface WithScopeOptions {
    /** Overrides global {@link LogOptions.minLevel} for this logger instance. */
    minLevel?: LogLevel;
}

const DEFAULT_OPTIONS: LogOptions = {
    formatTimestamp: true,
    formatEmoji: true,
    formatPrefix: "",
    minLevel: isDevEnvironment() ? LogLevel.DEBUG : LogLevel.INFO,
};

interface LoggerWithScope {
    debug: (message: LogParams["message"], restParams: LogRestParams) => void;
    info: (message: LogParams["message"], restParams: LogRestParams) => void;
    success: (message: LogParams["message"], restParams: LogRestParams) => void;
    warn: (message: LogParams["message"], restParams: LogRestParams) => void;
    error: (message: LogParams["message"], restParams: LogRestParams) => void;
    critical: (message: LogParams["message"], restParams: LogRestParams) => void;
    /** Merge labels / module into this logger's bound scope (trace fields are not mutable). */
    resetScope: (patch: LoggerResetScopePatch) => void;
}

function mergeLogOptions(options?: Partial<LogOptions>): LogOptions {
    return { ...DEFAULT_OPTIONS, ...options };
}

function formatDataValue(value: unknown): string {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function validateLogScope(logScope: LogScope): void {
    const missing: string[] = [];
    if (!logScope.module?.trim()) {
        missing.push("module");
    }
    if (!logScope.traceId?.trim()) {
        missing.push("traceId");
    }
    if (logScope.traceParentId !== null && typeof logScope.traceParentId !== "string") {
        missing.push("traceParentId");
    }
    if (missing.length > 0) {
        console.warn(`[LogManager] LogScope missing or invalid: ${missing.join(", ")}`, logScope);
    }
}

class LogManager {
    private static instance: LogManager;
    private options: LogOptions;
    private readonly levelEmojis = {
        [LogLevel.DEBUG]: "🔍",
        [LogLevel.INFO]: "ℹ️",
        [LogLevel.SUCCESS]: "✅",
        [LogLevel.WARN]: "⚠️",
        [LogLevel.ERROR]: "❌",
        [LogLevel.CRITICAL]: "💀",
    };

    private constructor(options?: Partial<LogOptions>) {
        this.options = mergeLogOptions(options);
    }

    public static getInstance(options?: Partial<LogOptions>): LogManager {
        if (!LogManager.instance) {
            LogManager.instance = new LogManager(options);
        } else if (options != null && Object.keys(options).length > 0) {
            console.warn(
                "[LogManager] getInstance(options) ignored — singleton already created. Use setOptions() instead.",
            );
        }
        return LogManager.instance;
    }

    public setOptions(options: Partial<LogOptions>): void {
        this.options = mergeLogOptions({ ...this.options, ...options });
    }

    private getMinLevel(): LogLevel {
        return this.options.minLevel ?? DEFAULT_OPTIONS.minLevel ?? LogLevel.INFO;
    }

    private shouldLog(level: LogLevel, scopeMinLevel?: LogLevel): boolean {
        const minLevel = scopeMinLevel ?? this.getMinLevel();
        return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLevel];
    }

    private createLogEntry(payload: LogEntryPayload): LogEntry {
        const { level, message, topic, extra, data, module, traceId, traceParentId, labels } = payload;
        return {
            timestamp: Date.now(),
            level,
            message,
            topic,
            module,
            traceId,
            traceParentId,
            labels,
            extra,
            data,
        };
    }

    private formatLevelTag(entry: LogEntry): string {
        const emoji = this.options.formatEmoji ? `${this.levelEmojis[entry.level]} ` : "";
        if (entry.level === LogLevel.CRITICAL) {
            return `[${emoji}*** ${entry.level} ***]`;
        }
        return `[${emoji}${entry.level}]`;
    }

    private formatLog(entry: LogEntry): string {
        const parts: string[] = [];

        if (this.options.formatTimestamp) {
            parts.push(`[${new Date(entry.timestamp).toISOString()}]`);
        }

        parts.push(this.formatLevelTag(entry));
        parts.push(
            `traceId=${entry.traceId} parent=${entry.traceParentId ?? "null"} labels=${formatScopeLabels(entry.labels)} module=${entry.module} topic=${entry.topic}`,
        );

        if (this.options.formatPrefix) {
            parts.push(`prefix=${this.options.formatPrefix}`);
        }

        const message = entry.level === LogLevel.CRITICAL ? `>>> ${entry.message} <<<` : entry.message;
        parts.push(`| ${message}`);

        if (entry.extra) {
            parts.push(`| extra=${entry.extra}`);
        }

        const dataText = formatDataValue(entry.data);
        if (dataText) {
            parts.push(`| data=${dataText}`);
        }

        return parts.join(" ");
    }

    private emitLog(entry: LogEntry, formatted: string): void {
        switch (entry.level) {
            case LogLevel.WARN:
                console.warn(formatted);
                break;
            case LogLevel.ERROR:
            case LogLevel.CRITICAL:
                console.error(formatted);
                break;
            default:
                console.log(formatted);
        }
    }

    private log(
        level: LogLevel,
        message: LogParams["message"],
        logScope: LogScope,
        restParams: LogRestParams,
        scopeMinLevel?: LogLevel,
    ) {
        if (!this.shouldLog(level, scopeMinLevel)) {
            return;
        }

        validateLogScope(logScope);
        if (!restParams.topic?.trim()) {
            throw new Error("[LogManager] topic is required on every log call");
        }

        const { topic, extra } = restParams;
        const data = resolveLogData(restParams);
        const entry = this.createLogEntry({
            level,
            message,
            topic,
            extra,
            data,
            ...logScope,
        });

        const formatted = this.formatLog(entry);
        this.emitLog(entry, formatted);
        this.options.onLog?.(entry);
    }

    public generateTraceId(): string {
        return generateUniqueId();
    }

    public debug(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.DEBUG, message, logScope, restParams);
    }

    public info(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.INFO, message, logScope, restParams);
    }

    public success(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.SUCCESS, message, logScope, restParams);
    }

    public warn(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.WARN, message, logScope, restParams);
    }

    public error(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.ERROR, message, logScope, restParams);
    }

    public critical(message: LogParams["message"], logScope: LogScope, restParams: LogRestParams) {
        this.log(LogLevel.CRITICAL, message, logScope, restParams);
    }

    public withScope(scope: LogScope, options?: WithScopeOptions): { logger: LoggerWithScope; scope: LogScope } {
        const boundScope: LogScope = { ...scope, labels: scope.labels ? { ...scope.labels } : undefined };
        const scopeMinLevel = options?.minLevel;

        const logger: LoggerWithScope = {
            debug: (message, restParams) => this.log(LogLevel.DEBUG, message, boundScope, restParams, scopeMinLevel),
            info: (message, restParams) => this.log(LogLevel.INFO, message, boundScope, restParams, scopeMinLevel),
            success: (message, restParams) =>
                this.log(LogLevel.SUCCESS, message, boundScope, restParams, scopeMinLevel),
            warn: (message, restParams) => this.log(LogLevel.WARN, message, boundScope, restParams, scopeMinLevel),
            error: (message, restParams) => this.log(LogLevel.ERROR, message, boundScope, restParams, scopeMinLevel),
            critical: (message, restParams) =>
                this.log(LogLevel.CRITICAL, message, boundScope, restParams, scopeMinLevel),
            resetScope: (patch) => {
                const next = patchScope({
                    scope: boundScope,
                    patch,
                    allowTraceMutation: false,
                });
                boundScope.module = next.module;
                boundScope.traceId = next.traceId;
                boundScope.traceParentId = next.traceParentId;
                boundScope.labels = next.labels;
            },
        };

        return { logger, scope: boundScope };
    }
}

export const logManager = LogManager.getInstance();
export type { LogEntry, LoggerWithScope, LogOptions, LogRestParams, WithScopeOptions };
export { LogLevel, LogManager };
