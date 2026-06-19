import { isDevEnvironment } from "../../core.utils";
import { generateUniqueId } from "../utils/id.utils";

enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    SUCCESS = "SUCCESS",
    WARN = "WARN",
    ERROR = "ERROR",
}

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.SUCCESS]: 2,
    [LogLevel.WARN]: 3,
    [LogLevel.ERROR]: 4,
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
    debug: (message: LogParams["message"], restParams?: LogRestParams) => void;
    info: (message: LogParams["message"], restParams?: LogRestParams) => void;
    success: (message: LogParams["message"], restParams?: LogRestParams) => void;
    warn: (message: LogParams["message"], restParams?: LogRestParams) => void;
    error: (message: LogParams["message"], restParams?: LogRestParams) => void;
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

    private formatLog(entry: LogEntry): string {
        const parts: string[] = [];

        if (this.options.formatTimestamp) {
            parts.push(`[${new Date(entry.timestamp).toISOString()}]`);
        }

        const emoji = this.options.formatEmoji ? `${this.levelEmojis[entry.level]} ` : "";
        parts.push(`[${emoji}${entry.level}]`);
        parts.push(
            `traceId=${entry.traceId} nodeId=${entry.nodeId ?? "--"} module=${entry.module} topic=${entry.topic ?? "--"}`
        );

        if (this.options.formatPrefix) {
            parts.push(`prefix=${this.options.formatPrefix}`);
        }

        parts.push(`| ${entry.message}`);

        if (entry.extra) {
            parts.push(`| extra=${entry.extra}`);
        }

        const contextText = formatContextValue(entry.context);
        if (contextText) {
            parts.push(`| context=${contextText}`);
        }

        return parts.join(" ");
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

        console.log(this.formatLog(entry));
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

    public withContext(context: LogContext): { logger: LoggerWithContext; context: LogContext } {
        return {
            logger: {
                debug: (message, restParams) => this.debug(message, context, restParams),
                info: (message, restParams) => this.info(message, context, restParams),
                success: (message, restParams) => this.success(message, context, restParams),
                warn: (message, restParams) => this.warn(message, context, restParams),
                error: (message, restParams) => this.error(message, context, restParams),
            },
            context,
        };
    }
}

const logger = LogManager.getInstance();

export default logger;
export { LogManager, LogLevel };
export { createApiLogger } from "./create-api-logger";
export type { CreateApiLoggerOptions } from "./create-api-logger";
export type { LogOptions, LogEntry, LogContext, LoggerWithContext, LogRestParams };
