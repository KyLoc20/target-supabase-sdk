import type { LogEntry } from "../core/log-manager";
import type { LogSpoolCoreProcessRole, LogSpoolProcessRole } from "./process-roles";

/** On-disk batch before guard upload — producer writes `.tmp`, guard renames to `.json` after post. */
export interface LogSpoolBatchFile {
    entries: LogEntry[];
    meta?: Record<string, unknown>;
}

export interface LogSpoolWriterConfig {
    maxEntries: number;
    maxBytes: number;
    flushDebounceMs: number;
    /** Flush buffered entries after this age even when below count/byte thresholds. */
    maxAgeMs: number;
    postTimeoutMs: number;
}

export interface LogSpoolGcConfig {
    /** How often guard runs tmp/json GC (upload collect still runs every collect tick). */
    intervalMs: number;
    syncedRetentionMs: number;
    tmpRetentionMs: number;
}

export interface LogSpoolConfig {
    writer: LogSpoolWriterConfig;
    gc: LogSpoolGcConfig;
    collectIntervalMs: number;
}

export interface EnableLogSpoolOptions {
    /** Service instance id (`Service.id` from registry claim). */
    serviceId: string;
    /** Spool directory name — core or {@link LOG_SPOOL_EXTRA_PROCESS_ROLES_ENV} extra. */
    processRole: LogSpoolProcessRole;
    /** Logical service value for List meta (`LOG_PERSIST_SERVICE`, e.g. `watch-service`). */
    serviceValue: string;
    spoolRoot?: string;
    config?: Partial<LogSpoolConfig>;
}

export interface EnsureLogSpoolFromEnvOptions {
    serviceId?: string;
    processRole?: LogSpoolProcessRole;
    serviceValue?: string;
    spoolRoot?: string;
    config?: Partial<LogSpoolConfig>;
}

export interface LogSpoolWriterStats {
    enabled: boolean;
    bufferedEntries: number;
    bufferedBytes: number;
    flushInProgress: boolean;
    debouncePending: boolean;
    ageFlushPending: boolean;
    serviceId: string | null;
    processRole: LogSpoolProcessRole | null;
}

export type { LogSpoolCoreProcessRole, LogSpoolProcessRole };
