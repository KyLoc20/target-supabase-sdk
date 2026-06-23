import { isDevEnvironment } from "../../core.utils";
import { generateUniqueId } from "../utils/id.utils";

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

interface LogEntry {
    timestamp: number;
    level: LogLevel;
    /** Tell people what happened, but more structured */
    message: string;
    /** Category of a kind of log */
    topic: string | null;
    /** Where the log comes from */
    module: string;
    /** Specific process — correlates one logical chain (loop, request). */
    traceId: string;
    /** Worker node id when the log is node-scoped; omit for scheduler / admin / API-only paths. */
    nodeId?: string;
    extra?: string;
    context?: unknown;
}

interface LogContext {
    module: LogEntry["module"];
    traceId: LogEntry["traceId"];
    nodeId?: LogEntry["nodeId"];
}

type LogRestParams = Omit<LogParams, "message">;

interface LogEntryPayload {
    message: LogEntry["message"];
    topic?: LogEntry["topic"];
    extra?: LogEntry["extra"];
    context?: LogEntry["context"];
    level: LogEntry["level"];
    module: LogEntry["module"];
    traceId: LogEntry["traceId"];
    nodeId?: LogEntry["nodeId"];
}

type LogParams = Pick<LogEntryPayload, "message" | "topic" | "extra" | "context">;

interface LogOptions {
    defaultTopic: LogEntry["topic"];
    formatTimestamp: boolean;
    formatEmoji: boolean;
    formatPrefix: string;
    maxHistoryLength: number;
    /** Logs below this level are skipped. Defaults to DEBUG in dev, INFO in production. */
    minLevel?: LogLevel;
    onLog?: (entry: LogEntry) => void;
}

const DEFAULT_OPTIONS: LogOptions = {
    defaultTopic: null,
    formatTimestamp: true,
    formatEmoji: true,
    formatPrefix: "",
    maxHistoryLength: 4096,
    minLevel: isDevEnvironment() ? LogLevel.DEBUG : LogLevel.INFO,
};

interface LoggerWithContext {
    /** Rank 0 — diagnostic detail; dev/troubleshooting only. */
    debug: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Rank 1 — normal operational flow. */
    info: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Rank 2 — positive milestone (semantic INFO, not higher severity). */
    success: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Rank 3 — recoverable anomaly; system continues. */
    warn: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Rank 4 — a concrete operation failed; needs investigation. */
    error: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Rank 5 — invariant / design / integrity breach; escalate immediately. */
    critical: (message: LogParams["message"], restParams?: LogRestParams) => void;
    /** Merge partial fields into this logger's bound context (e.g. nodeId after register). */
    resetContext: (fields: Partial<LogContext>) => void;
}

function mergeLogOptions(options?: Partial<LogOptions>): LogOptions {
    return { ...DEFAULT_OPTIONS, ...options };
}

function formatContextValue(value: unknown): string {
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

function validateLogContext(logContext: LogContext): void {
    const missing: string[] = [];
    if (!logContext.module?.trim()) {
        missing.push("module");
    }
    if (!logContext.traceId?.trim()) {
        missing.push("traceId");
    }
    if (missing.length > 0) {
        console.warn(`[LogManager] LogContext missing or empty: ${missing.join(", ")}`, logContext);
    }
}

class LogManager {
    private static instance: LogManager;
    private options: LogOptions;
    private history: LogEntry[] = [];
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
            console.warn("[LogManager] getInstance(options) ignored — singleton already created. Use setOptions() instead.");
        }
        return LogManager.instance;
    }

    public setOptions(options: Partial<LogOptions>): void {
        this.options = mergeLogOptions({ ...this.options, ...options });
    }

    public getHistory(): LogEntry[] {
        return [...this.history];
    }

    public clearHistory(): void {
        this.history = [];
    }

    private getMinLevel(): LogLevel {
        return this.options.minLevel ?? DEFAULT_OPTIONS.minLevel ?? LogLevel.INFO;
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[this.getMinLevel()];
    }

    private createLogEntry({
        level,
        message,
        topic,
        module,
        traceId,
        nodeId,
        extra,
        context,
    }: LogEntryPayload): LogEntry {
        return {
            timestamp: Date.now(),
            level,
            message,
            topic: topic === undefined ? this.options.defaultTopic : topic,
            module,
            traceId,
            nodeId,
            extra,
            context,
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
            `traceId=${entry.traceId} nodeId=${entry.nodeId ?? "--"} module=${entry.module} topic=${entry.topic ?? "--"}`
        );

        if (this.options.formatPrefix) {
            parts.push(`prefix=${this.options.formatPrefix}`);
        }

        const message =
            entry.level === LogLevel.CRITICAL ? `>>> ${entry.message} <<<` : entry.message;
        parts.push(`| ${message}`);

        if (entry.extra) {
            parts.push(`| extra=${entry.extra}`);
        }

        const contextText = formatContextValue(entry.context);
        if (contextText) {
            parts.push(`| context=${contextText}`);
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
        logContext: LogContext,
        restParams?: LogRestParams
    ) {
        if (!this.shouldLog(level)) {
            return;
        }

        validateLogContext(logContext);

        const { topic, extra, context } = restParams ?? {};
        const { module, traceId, nodeId } = logContext;
        const entry = this.createLogEntry({ level, message, topic, extra, context, module, traceId, nodeId });

        this.history.push(entry);
        if (this.history.length > this.options.maxHistoryLength) {
            this.history.shift();
        }

        const formatted = this.formatLog(entry);
        this.emitLog(entry, formatted);
        this.options.onLog?.(entry);
    }

    public generateTraceId(): string {
        return generateUniqueId();
    }

    public debug(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.DEBUG, message, logContext, restParams);
    }

    public info(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.INFO, message, logContext, restParams);
    }

    public success(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.SUCCESS, message, logContext, restParams);
    }

    public warn(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.WARN, message, logContext, restParams);
    }

    public error(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.ERROR, message, logContext, restParams);
    }

    public critical(message: LogParams["message"], logContext: LogContext, restParams?: LogRestParams) {
        this.log(LogLevel.CRITICAL, message, logContext, restParams);
    }

    public withContext(context: LogContext): { logger: LoggerWithContext; context: LogContext } {
        const boundContext: LogContext = { ...context };

        const logger: LoggerWithContext = {
            debug: (message, restParams) => this.debug(message, boundContext, restParams),
            info: (message, restParams) => this.info(message, boundContext, restParams),
            success: (message, restParams) => this.success(message, boundContext, restParams),
            warn: (message, restParams) => this.warn(message, boundContext, restParams),
            error: (message, restParams) => this.error(message, boundContext, restParams),
            critical: (message, restParams) => this.critical(message, boundContext, restParams),
            resetContext: (fields) => {
                Object.assign(boundContext, fields);
            },
        };

        return { logger, context: boundContext };
    }
}

const logger = LogManager.getInstance();

export default logger;
export { LogManager, LogLevel };
export { createApiLogger } from "./create-api-logger";
export type { CreateApiLoggerOptions } from "./create-api-logger";
export type { LogOptions, LogEntry, LogContext, LoggerWithContext, LogRestParams };
