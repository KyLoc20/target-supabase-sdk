import { createLogger } from "../core/create-logger";

/** User-facing / lifecycle logs — may be persisted like normal app logs. */
export const LOG_PERSIST_TOPIC = "log-persist";

/** Operational logs from the persist pipeline — never re-offered to avoid feedback loops. */
export const LOG_PERSIST_INTERNAL_TOPIC = "log-persist-internal";

type PipelineLogData = Record<string, unknown>;

function createPipelineLogger(module: string) {
    const logger = createLogger({ module });

    function write(level: "debug" | "info" | "warn" | "error", message: string, data?: PipelineLogData): void {
        logger[level](message, {
            topic: LOG_PERSIST_INTERNAL_TOPIC,
            ...(data != null ? { data } : {}),
        });
    }

    return {
        debug: (message: string, data?: PipelineLogData) => write("debug", message, data),
        info: (message: string, data?: PipelineLogData) => write("info", message, data),
        warn: (message: string, data?: PipelineLogData) => write("warn", message, data),
        error: (message: string, data?: PipelineLogData) => write("error", message, data),
    };
}

/** Supabase upload path (`postLogBatch`). */
export const persistLogger = createPipelineLogger("log-upload");

/** File spool writer + collector. */
export const spoolLogger = createPipelineLogger("log-spool");

export function isLogPersistInternalTopic(topic: string | undefined): boolean {
    return topic === LOG_PERSIST_INTERNAL_TOPIC;
}
