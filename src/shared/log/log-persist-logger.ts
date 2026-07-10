import { createLogger } from "./create-logger";

/** User-facing / lifecycle logs — may be persisted like normal app logs. */
export const LOG_PERSIST_TOPIC = "log-persist";

/** Operational logs from the persist pipeline — never re-offered to avoid feedback loops. */
export const LOG_PERSIST_INTERNAL_TOPIC = "log-persist-internal";

const logger = createLogger({ module: "log-persist" });

export function isLogPersistInternalTopic(topic: string | undefined): boolean {
    return topic === LOG_PERSIST_INTERNAL_TOPIC;
}

type PersistLogData = Record<string, unknown>;

function write(level: "debug" | "info" | "warn" | "error", message: string, data?: PersistLogData): void {
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
