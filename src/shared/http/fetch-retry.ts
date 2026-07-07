import type { LoggerWithScope } from "../log/index.js";
import { classifyNetworkError, formatNetworkError } from "../utils/network-error.js";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default HTTP statuses that trigger retry (429, 5xx). */
export function isRetryableHttpStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

export type FetchInitFactory = () => RequestInit;

export function requestHasBody(init: RequestInit): boolean {
    return init.body != null;
}

export interface FetchRetryOptions {
    label: string;
    timeoutMs: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    maxBackoffMs?: number;
    /** undici ProxyAgent or other fetch extension — typed loosely to avoid undici dependency. */
    dispatcher?: unknown;
    isRetryableStatus?: (status: number) => boolean;
    /** When set, retry/success lines are logged via SDK logger. */
    logger?: LoggerWithScope;
    hint?: string;
}

function backoffMs(
    retryBaseMs: number,
    attempt: number,
    response?: Response,
    maxBackoffMs?: number
): number {
    const retryAfter = response?.headers.get("Retry-After");
    if (retryAfter != null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) {
            const delayMs = seconds * 1000;
            return maxBackoffMs != null ? Math.min(delayMs, maxBackoffMs) : delayMs;
        }
    }

    let delayMs = retryBaseMs * 2 ** (attempt - 1);
    if (maxBackoffMs != null) {
        delayMs = Math.min(delayMs, maxBackoffMs);
    }
    return delayMs;
}

async function fetchOnce(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    dispatcher?: unknown
): Promise<Response> {
    const options: RequestInit & { dispatcher?: unknown } = {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
    };
    if (dispatcher != null) {
        options.dispatcher = dispatcher;
    }
    return fetch(url, options);
}

export async function fetchWithRetry(
    url: string,
    initOrFactory: RequestInit | FetchInitFactory,
    options: FetchRetryOptions
): Promise<Response> {
    const maxAttempts = options.maxAttempts ?? 1;
    const retryBaseMs = options.retryBaseMs ?? 2_000;
    const isRetryableStatus = options.isRetryableStatus ?? isRetryableHttpStatus;
    const buildInit =
        typeof initOrFactory === "function" ? initOrFactory : () => initOrFactory;

    if (maxAttempts > 1 && typeof initOrFactory !== "function" && requestHasBody(initOrFactory)) {
        throw new Error(
            `${options.label}: retry requires an init factory when request body may be consumed`
        );
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetchOnce(
                url,
                buildInit(),
                options.timeoutMs,
                options.dispatcher
            );

            if (!response.ok && isRetryableStatus(response.status) && attempt < maxAttempts) {
                const delayMs = backoffMs(retryBaseMs, attempt, response, options.maxBackoffMs);
                if (options.logger != null) {
                    options.logger.warn("retrying after HTTP error", {
                        topic: "fetch",
                        data: {
                            label: options.label,
                            attempt,
                            status: response.status,
                            delayMs,
                        },
                    });
                }
                await sleep(delayMs);
                continue;
            }

            if (attempt > 1 && options.logger != null) {
                options.logger.info("request succeeded after retry", {
                    topic: "fetch",
                    data: { label: options.label, attempt },
                });
            }

            return response;
        } catch (error) {
            const classified = classifyNetworkError(error);
            lastError = new Error(
                formatNetworkError(error, options.label, { hint: options.hint })
            );

            if (classified.retryable && attempt < maxAttempts) {
                const delayMs = backoffMs(retryBaseMs, attempt, undefined, options.maxBackoffMs);
                if (options.logger != null) {
                    options.logger.warn("retrying after network error", {
                        topic: "fetch",
                        data: {
                            label: options.label,
                            attempt,
                            maxAttempts,
                            kind: classified.kind,
                            code: classified.code,
                            delayMs,
                        },
                    });
                }
                await sleep(delayMs);
                continue;
            }
            throw lastError;
        }
    }

    throw lastError ?? new Error(`${options.label}: request failed`);
}

export async function fetchBinaryWithRetry(
    url: string,
    init: RequestInit,
    options: FetchRetryOptions
): Promise<ArrayBuffer> {
    const response = await fetchWithRetry(url, init, options);
    if (!response.ok) {
        throw new Error(`${options.label}: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}
