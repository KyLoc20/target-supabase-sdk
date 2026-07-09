/**
 * JSON-RPC over WebSocket — implemented by chrome-extension-starter `src/background/sdk-bridge/`
 *
 * Request:  { id, type: "request", method, params }
 * Response: { id, type: "response", result? } | { id, type: "response", error: { message } }
 *
 * Hub-local:
 * - hub.pingBridge  {}  → { ok, uptimeMs, stableForMs, pingOk, pingLatencyMs? }
 *
 * Extension methods:
 * - openTab       { tabKey, url }
 * - waitForSelector { tabKey, selector, timeoutMs? }
 * - click         { tabKey, selector }
 * - closeTab      { tabKey, tabId? }
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
/** Max single waitForSelector RPC inside pollForSelector (extension may still be loading DOM). */
const DEFAULT_POLL_SELECTOR_CHUNK_MS = 15_000;

const SELECTOR_TIMEOUT_PATTERN = /timeout waiting for selector/i;
const VERBOSE =
    process.env.CHROME_WS_VERBOSE === "1" ||
    process.env.CHROME_WS_VERBOSE === "true" ||
    process.env.CHROME_HUB_VERBOSE === "1" ||
    process.env.CHROME_HUB_VERBOSE === "true";

const RETRYABLE_ERROR_PATTERNS = [
    /chrome bridge not connected/i,
    /chrome bridge not stable/i,
    /chrome bridge disconnected/i,
    /bridge ping timeout/i,
    /failed to forward request/i,
    /controller disconnected/i,
    /hub shutting down/i,
];

async function resolveWebSocket() {
    if (globalThis.WebSocket != null) {
        return globalThis.WebSocket;
    }
    const { default: WS } = await import("ws");
    return WS;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message, extra) {
    if (extra != null) {
        console.log(`[chrome-ws-client] ${message}`, extra);
        return;
    }
    console.log(`[chrome-ws-client] ${message}`);
}

function warn(message, extra) {
    if (extra != null) {
        console.warn(`[chrome-ws-client] ${message}`, extra);
        return;
    }
    console.warn(`[chrome-ws-client] ${message}`);
}

function debug(message, extra) {
    if (!VERBOSE) {
        return;
    }
    log(`[verbose] ${message}`, extra);
}

export function isSelectorPollTimeoutError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return SELECTOR_TIMEOUT_PATTERN.test(message);
}

export function isRetryableBridgeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export class ChromeWsClient {
    #wsUrl;
    /** @type {import("ws").WebSocket | WebSocket | null} */
    #ws = null;
    /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout>, method: string, quiet?: boolean }>} */
    #pending = new Map();
    #nextId = 1;

    constructor(wsUrl) {
        this.#wsUrl = wsUrl;
    }

    get wsUrl() {
        return this.#wsUrl;
    }

    async connect(connectTimeoutMs = 10_000) {
        const WebSocketImpl = await resolveWebSocket();
        log("connecting", { wsUrl: this.#wsUrl, connectTimeoutMs });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                warn("connect timeout", { wsUrl: this.#wsUrl, connectTimeoutMs });
                reject(new Error(`WebSocket connect timeout: ${this.#wsUrl}`));
            }, connectTimeoutMs);

            const ws = new WebSocketImpl(this.#wsUrl);
            this.#ws = ws;

            const onOpen = () => {
                clearTimeout(timer);
                log("connected", { wsUrl: this.#wsUrl });
                resolve();
            };
            const onError = () => {
                clearTimeout(timer);
                warn("connect failed", { wsUrl: this.#wsUrl });
                reject(new Error(`WebSocket connect failed: ${this.#wsUrl}`));
            };
            const onClose = (event) => {
                const code = event?.code ?? event;
                const reason = event?.reason ?? "";
                warn("socket closed", { wsUrl: this.#wsUrl, code, reason: String(reason) || "(empty)" });
            };

            if ("addEventListener" in ws) {
                ws.addEventListener("open", onOpen, { once: true });
                ws.addEventListener("error", onError, { once: true });
                ws.addEventListener("close", onClose);
                ws.addEventListener("message", (event) => this.#onMessage(String(event.data)));
            } else {
                ws.on("open", onOpen);
                ws.on("error", onError);
                ws.on("close", onClose);
                ws.on("message", (data) => this.#onMessage(String(data)));
            }
        });
    }

    #onMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (error) {
            warn("invalid JSON", {
                preview: raw.slice(0, 200),
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        debug("message received", {
            type: message?.type,
            id: message?.id,
            hasError: message?.error != null,
        });

        if (message?.type !== "response" || message.id == null) {
            return;
        }

        const pending = this.#pending.get(String(message.id));
        if (pending == null) {
            warn("orphan response", { id: message.id });
            return;
        }

        this.#pending.delete(String(message.id));
        clearTimeout(pending.timer);

        if (message.error != null) {
            const msg =
                typeof message.error.message === "string" ? message.error.message : JSON.stringify(message.error);
            const logFn = pending.quiet && isSelectorPollTimeoutError(new Error(msg)) ? debug : warn;
            logFn("request failed", { id: message.id, method: pending.method, error: msg });
            pending.reject(new Error(msg));
            return;
        }

        log("request succeeded", { id: message.id, method: pending.method });
        pending.resolve(message.result);
    }

    request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, options = {}) {
        if (this.#ws == null) {
            return Promise.reject(new Error("WebSocket is not connected"));
        }

        const { quiet = false } = options;
        const id = String(this.#nextId++);
        const payload = JSON.stringify({ id, type: "request", method, params });

        debug("sending request", { id, method, timeoutMs, quiet });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                const timeoutError = new Error(`WebSocket request timeout: ${method}`);
                const logFn = quiet && method === "waitForSelector" ? debug : warn;
                logFn("request timeout", { id, method, timeoutMs });
                reject(timeoutError);
            }, timeoutMs);

            this.#pending.set(id, { resolve, reject, timer, method, quiet });

            if ("send" in this.#ws && typeof this.#ws.send === "function") {
                this.#ws.send(payload);
            } else {
                clearTimeout(timer);
                this.#pending.delete(id);
                reject(new Error("WebSocket send is unavailable"));
            }
        });
    }

    async requestWithRetry(method, params, options = {}) {
        const {
            timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
            maxAttempts = 3,
            baseDelayMs = 1_000,
            maxDelayMs = 8_000,
        } = options;

        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                if (attempt > 1) {
                    log("retrying request", { method, attempt, maxAttempts });
                }
                return await this.request(method, params, timeoutMs);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const retryable = isRetryableBridgeError(lastError);
                warn("request attempt failed", {
                    method,
                    attempt,
                    maxAttempts,
                    retryable,
                    error: lastError.message,
                });

                if (!retryable || attempt >= maxAttempts) {
                    throw lastError;
                }

                const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
                log("backing off before retry", { method, attempt, delayMs });
                await sleep(delayMs);
            }
        }

        throw lastError ?? new Error(`Request failed: ${method}`);
    }

    pingBridge(timeoutMs = 30_000) {
        return this.request("hub.pingBridge", {}, timeoutMs);
    }

    /**
     * Wait until hub reports bridge open + stable (+ optional pong).
     */
    async waitForBridgeReady(options = {}) {
        const { timeoutMs = 60_000, pingIntervalMs = 2_000, stableMs = 3_000 } = options;

        const deadline = Date.now() + timeoutMs;
        const startedAt = Date.now();
        let attempts = 0;

        log("waiting for bridge ready", { timeoutMs, pingIntervalMs, stableMs, wsUrl: this.#wsUrl });

        while (Date.now() < deadline) {
            attempts += 1;
            try {
                const health = await this.pingBridge(Math.min(pingIntervalMs + 5_000, deadline - Date.now()));
                const waitedMs = Date.now() - startedAt;
                log("bridge ready", {
                    attempts,
                    waitedMs,
                    uptimeMs: health?.uptimeMs,
                    stableForMs: health?.stableForMs,
                    pingOk: health?.pingOk,
                    pingLatencyMs: health?.pingLatencyMs,
                });
                return health;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                debug("bridge not ready yet", { attempts, error: message });
                await sleep(pingIntervalMs);
            }
        }

        const waitedMs = Date.now() - startedAt;
        warn("bridge ready wait timed out", { attempts, waitedMs, timeoutMs, wsUrl: this.#wsUrl });
        throw new Error(`Chrome bridge not ready within ${timeoutMs}ms (${attempts} attempts)`);
    }

    openTab(tabKey, url, options) {
        return this.requestWithRetry("openTab", { tabKey, url }, options);
    }

    waitForSelector(tabKey, selector, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, options) {
        return this.requestWithRetry("waitForSelector", { tabKey, selector, timeoutMs }, options);
    }

    click(tabKey, selector, options) {
        return this.requestWithRetry("click", { tabKey, selector }, options);
    }

    closeTab(tabKey, tabId, options) {
        const params = { tabKey };
        if (typeof tabId === "number") {
            params.tabId = tabId;
        }
        return this.requestWithRetry("closeTab", params, options);
    }

    /**
     * Poll until selector exists (client-side retry when server uses short internal waits).
     * @param {number} [pollChunkTimeoutMs] max wait per RPC (default 15s)
     */
    async pollForSelector(
        tabKey,
        selector,
        totalTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
        pollIntervalMs = 500,
        pollChunkTimeoutMs = DEFAULT_POLL_SELECTOR_CHUNK_MS,
    ) {
        const deadline = Date.now() + totalTimeoutMs;
        let lastError = null;
        let polls = 0;

        log("pollForSelector started", {
            tabKey,
            selector,
            totalTimeoutMs,
            pollIntervalMs,
            pollChunkTimeoutMs,
        });

        while (Date.now() < deadline) {
            polls += 1;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                break;
            }
            const chunkTimeoutMs = Math.min(remaining, pollChunkTimeoutMs);
            try {
                await this.request(
                    "waitForSelector",
                    { tabKey, selector, timeoutMs: chunkTimeoutMs },
                    chunkTimeoutMs + 5_000,
                    { quiet: true },
                );
                log("pollForSelector succeeded", { selector, polls });
                return;
            } catch (error) {
                lastError = error;
                debug("pollForSelector retry", {
                    selector,
                    polls,
                    chunkTimeoutMs,
                    error: error instanceof Error ? error.message : String(error),
                });
                await sleep(pollIntervalMs);
            }
        }

        warn("pollForSelector timed out", { selector, polls, totalTimeoutMs, pollChunkTimeoutMs });
        throw lastError ?? new Error(`Timeout waiting for selector: ${selector}`);
    }

    close() {
        const pendingCount = this.#pending.size;
        if (pendingCount > 0) {
            warn("closing with pending requests", { pendingCount });
        }

        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error("WebSocket closed"));
        }
        this.#pending.clear();

        if (this.#ws == null) {
            return;
        }

        log("closing connection", { wsUrl: this.#wsUrl });
        if ("close" in this.#ws && typeof this.#ws.close === "function") {
            this.#ws.close();
        }
        this.#ws = null;
    }
}
