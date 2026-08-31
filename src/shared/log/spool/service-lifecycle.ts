import { logSpoolEnabledFromEnv } from "../upload/env";
import { ensureLogSpoolFromEnv, getLogSpoolStats, shutdownLogSpoolFromEnv } from "./enable";
import type { LogSpoolWriterStats } from "./interface";

/** Whether file log spool is enabled (`LOG_PERSIST_ENABLED=true`). */
export function isLogSpoolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return logSpoolEnabledFromEnv(env);
}

/**
 * Guard / scheduler / worker (and extra roles) — enable writer from spawn env.
 * Main is enabled by `createServiceHost` after registry claim.
 */
export async function enableLogSpoolFromEnvInChild(): Promise<void> {
    if (!logSpoolEnabledFromEnv()) {
        return;
    }
    await ensureLogSpoolFromEnv();
}

/** Writer buffer stats when spool enabled; `null` when disabled. Typical use: main observability. */
export function getMainLogSpoolWriterStats(): LogSpoolWriterStats | null {
    if (!logSpoolEnabledFromEnv()) {
        return null;
    }
    return getLogSpoolStats();
}

/** Flush memory buffer and disable writer when spool enabled; no-op otherwise. */
export async function shutdownLogSpool(): Promise<void> {
    if (!logSpoolEnabledFromEnv()) {
        return;
    }
    await shutdownLogSpoolFromEnv();
}
