import type { LoggerWithScope } from "../../shared/log";
import { pollUntil } from "./poll-until";

export interface ServiceReadySnapshot {
    failed: boolean;
    ready: boolean;
    failureMessage?: string | null;
    /** Logged on success (e.g. worker tasks, pid). */
    readyDetail?: unknown;
}

/** Cross-process ready gate — service implements by reading shared state (file, RPC, …). */
export interface ServiceReadyGate {
    read(): Promise<ServiceReadySnapshot>;
}

export interface WaitForServiceReadyOptions {
    timeoutMs: number;
    pollMs?: number;
    logger?: Pick<LoggerWithScope, "info">;
    /** Default failure message when gate.read().failureMessage is empty. */
    failureMessage?: string;
    formatTimeoutError?: (last: ServiceReadySnapshot, timeoutMs: number) => string;
}

/**
 * Poll {@link ServiceReadyGate} until ready, fail fast on `failed`, or timeout.
 * Returns the final ready snapshot.
 */
export async function waitForServiceReady(
    gate: ServiceReadyGate,
    options: WaitForServiceReadyOptions,
): Promise<ServiceReadySnapshot> {
    const pollMs = options.pollMs ?? 500;
    const defaultFailureMessage = options.failureMessage ?? "Readiness checks failed";
    let last: ServiceReadySnapshot = { failed: false, ready: false };

    try {
        await pollUntil({
            timeoutMs: options.timeoutMs,
            intervalMs: pollMs,
            until: async () => {
                last = await gate.read();
                if (last.failed) {
                    throw new Error(last.failureMessage ?? defaultFailureMessage);
                }
                return last.ready;
            },
        });
    } catch (error) {
        if (last.failed) {
            throw error instanceof Error ? error : new Error(defaultFailureMessage);
        }
        const isPollTimeout = error instanceof Error && error.message.startsWith("pollUntil timeout after");
        if (!isPollTimeout) {
            throw error;
        }
        const message =
            options.formatTimeoutError?.(last, options.timeoutMs) ??
            `Service ready timeout after ${options.timeoutMs}ms (failed=${last.failed}, ready=${last.ready})`;
        throw new Error(message);
    }

    options.logger?.info("service ready", {
        topic: "readiness",
        data: last.readyDetail ?? {},
    });
    return last;
}
