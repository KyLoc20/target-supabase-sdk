import { createLogger } from "./create-logger";

/** User-facing / lifecycle logs — may be persisted like normal app logs. */
export const LOG_PERSIST_TOPIC = "log-persist";

/** Operational logs from the persist pipeline — never re-offered to avoid feedback loops. */
export const LOG_PERSIST_INTERNAL_TOPIC = "log-persist-internal";

const logger = createLogger({ module: "log-persist" });

let errorLogRateLimitMs = 5_000;
const lastLoggedAt = new Map<string, number>();

export function configurePersistLoggerRateLimit(ms: number): void {
    errorLogRateLimitMs = Math.max(0, ms);
}

export function isLogPersistInternalTopic(topic: string | undefined): boolean {
    return topic === LOG_PERSIST_INTERNAL_TOPIC;
}

type PersistLogData = Record<string, unknown>;

function shouldEmit(level: "debug" | "info" | "warn" | "error", message: string): boolean {
    if (level !== "error" && level !== "warn") {
        return true;
    }
    if (errorLogRateLimitMs <= 0) {
        return true;
    }

    const key = `${level}:${message}`;
    const now = Date.now();
    const last = lastLoggedAt.get(key);
    if (last != null && now - last < errorLogRateLimitMs) {
        return false;
    }
    lastLoggedAt.set(key, now);
    return true;
}

function write(level: "debug" | "info" | "warn" | "error", message: string, data?: PersistLogData): void {
    if (!shouldEmit(level, message)) {
        return;
    }
    logger[level](message, {
        topic: LOG_PERSIST_INTERNAL_TOPIC,
        ...(data != null ? { data } : {}),
    });
}

export const persistLogger = {
    debug: (message: string, data?: PersistLogData) => write("debug", message, data),
    info: (message: string, data?: PersistLogData) => write("info", message, data),
    warn: (message: string, data?: PersistLogData) => write("warn", message, data),
    error: (message: string, data?: PersistLogData) => write("error", message, data),
};

export function patchPersistLoggerScope(labels: Record<string, string>): void {
    logger.resetScope({ labels });
}
