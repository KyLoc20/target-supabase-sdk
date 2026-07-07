function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollUntilOptions {
    timeoutMs: number;
    intervalMs?: number;
    until: () => boolean | Promise<boolean>;
}

/**
 * Poll `until()` until it returns true or `timeoutMs` elapses.
 * @throws Error on timeout
 */
export async function pollUntil(options: PollUntilOptions): Promise<void> {
    const intervalMs = options.intervalMs ?? 500;
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
        if (await options.until()) {
            return;
        }
        await sleep(intervalMs);
    }

    throw new Error(`pollUntil timeout after ${options.timeoutMs}ms`);
}
