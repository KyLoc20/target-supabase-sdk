import type { LoggerWithScope } from "../../shared/log";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    options: WaitForServiceReadyOptions
): Promise<ServiceReadySnapshot> {
    const pollMs = options.pollMs ?? 500;
    const defaultFailureMessage = options.failureMessage ?? "Readiness checks failed";
    const deadline = Date.now() + options.timeoutMs;
    let last: ServiceReadySnapshot = { failed: false, ready: false };

    while (Date.now() < deadline) {
        last = await gate.read();

        if (last.failed) {
            throw new Error(last.failureMessage ?? defaultFailureMessage);
        }

        if (last.ready) {
            options.logger?.info("service ready", {
                topic: "readiness",
                data: last.readyDetail ?? {},
            });
            return last;
        }

        await sleep(pollMs);
    }

    const message =
        options.formatTimeoutError?.(last, options.timeoutMs) ??
        `Service ready timeout after ${options.timeoutMs}ms (failed=${last.failed}, ready=${last.ready})`;

    throw new Error(message);
}
