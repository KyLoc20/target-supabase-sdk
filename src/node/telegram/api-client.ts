import { type Dispatcher, ProxyAgent } from "undici";
import {
    createLogger,
    type FetchInitFactory,
    fetchBinaryWithRetry,
    fetchWithRetry,
    isRetryableHttpStatus,
} from "../../browser";
import type { ResolvedTelegramStorageOptions, TelegramApiResponse } from "./types";

const logger = createLogger({ module: "telegram" });

let cachedDispatcher: Dispatcher | undefined;
let cachedProxyUrl: string | undefined;

/** Per-request undici dispatcher when proxyUrl is set (Supabase stays direct). */
function telegramFetchDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
    if (proxyUrl == null) {
        return undefined;
    }
    if (cachedDispatcher != null && cachedProxyUrl === proxyUrl) {
        return cachedDispatcher;
    }
    cachedDispatcher = new ProxyAgent(proxyUrl);
    cachedProxyUrl = proxyUrl;
    return cachedDispatcher;
}

function telegramNetworkHint(proxyUrl: string | undefined): string {
    return proxyUrl
        ? ` (proxy=${proxyUrl}, ensure Clash/V2Ray is running)`
        : " (set proxyUrl / TELEGRAM_PROXY if api.telegram.org is blocked)";
}

export interface CallTelegramOptions {
    timeoutMs?: number;
    retryAttempts?: number;
    retryBaseMs?: number;
}

function botApiUrl(options: ResolvedTelegramStorageOptions, method: string): string {
    return `${options.apiBaseUrl}/bot${options.botToken}/${method}`;
}

export function telegramFileDownloadUrl(options: ResolvedTelegramStorageOptions, filePath: string): string {
    const normalized = filePath.replace(/^\/+/, "");
    return `${options.apiBaseUrl}/file/bot${options.botToken}/${normalized}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramBackoff(attempt: number, retryBaseMs: number): Promise<void> {
    return sleep(retryBaseMs * 2 ** (attempt - 1));
}

/** Bot API JSON call — transport retry via SDK fetch; outer loop retries Telegram `{ ok: false }`. */
export async function callTelegramApi<T>(
    options: ResolvedTelegramStorageOptions,
    method: string,
    initOrFactory: RequestInit | FetchInitFactory,
    callOptions: CallTelegramOptions = {},
): Promise<T> {
    const timeoutMs = callOptions.timeoutMs ?? options.fetchTimeoutMs;
    const maxAttempts = callOptions.retryAttempts ?? 1;
    const retryBaseMs = callOptions.retryBaseMs ?? options.uploadRetryBaseMs;
    const url = botApiUrl(options, method);
    const label = `Telegram ${method}`;
    const dispatcher = telegramFetchDispatcher(options.proxyUrl);
    const hint = telegramNetworkHint(options.proxyUrl);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await fetchWithRetry(url, initOrFactory, {
            label,
            timeoutMs,
            maxAttempts: attempt === 1 ? maxAttempts : 1,
            retryBaseMs,
            dispatcher,
            hint,
            logger,
        });

        let payload: TelegramApiResponse<T>;
        try {
            payload = (await response.json()) as TelegramApiResponse<T>;
        } catch {
            lastError = new Error(`${label}: invalid JSON response (HTTP ${response.status})`);
            if (attempt < maxAttempts && isRetryableHttpStatus(response.status)) {
                await telegramBackoff(attempt, retryBaseMs);
                continue;
            }
            throw lastError;
        }

        if (!payload.ok) {
            const description = payload.description ?? `HTTP ${response.status}`;
            lastError = new Error(`${label}: ${description}`);
            if (attempt < maxAttempts && isRetryableHttpStatus(response.status)) {
                logger.warn("retrying after API error", {
                    topic: "telegram",
                    data: { method, attempt, description },
                });
                await telegramBackoff(attempt, retryBaseMs);
                continue;
            }
            throw lastError;
        }

        if (payload.result == null) {
            throw new Error(`${label}: empty result in response`);
        }

        if (attempt > 1) {
            logger.info("request succeeded after retry", { topic: "telegram", data: { method, attempt } });
        }

        return payload.result;
    }

    throw lastError ?? new Error(`${label}: request failed`);
}

export async function telegramDownloadBinary(
    options: ResolvedTelegramStorageOptions,
    url: string,
    label: string,
    callOptions: CallTelegramOptions = {},
): Promise<ArrayBuffer> {
    const dispatcher = telegramFetchDispatcher(options.proxyUrl);
    return fetchBinaryWithRetry(
        url,
        { method: "GET" },
        {
            label: `Telegram ${label}`,
            timeoutMs: callOptions.timeoutMs ?? options.fetchTimeoutMs,
            maxAttempts: callOptions.retryAttempts ?? 1,
            retryBaseMs: callOptions.retryBaseMs ?? options.uploadRetryBaseMs,
            dispatcher,
            hint: telegramNetworkHint(options.proxyUrl),
            logger,
        },
    );
}
