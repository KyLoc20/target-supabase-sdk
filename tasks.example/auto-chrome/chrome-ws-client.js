/**
 * JSON-RPC over WebSocket — implemented by chrome-extension-starter `src/background/sdk-bridge/`
 *
 * Request:  { id, type: "request", method, params }
 * Response: { id, type: "response", result? } | { id, type: "response", error: { message } }
 *
 * Methods:
 * - openTab       { tabKey, url }           → waits until tab load complete
 * - waitForSelector { tabKey, selector, timeoutMs? }
 * - click         { tabKey, selector }
 * - closeTab      { tabKey, tabId? }
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

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

export class ChromeWsClient {
    #wsUrl;
    /** @type {import("ws").WebSocket | WebSocket | null} */
    #ws = null;
    /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
    #pending = new Map();
    #nextId = 1;

    constructor(wsUrl) {
        this.#wsUrl = wsUrl;
    }

    async connect(connectTimeoutMs = 10_000) {
        const WebSocketImpl = await resolveWebSocket();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`WebSocket connect timeout: ${this.#wsUrl}`));
            }, connectTimeoutMs);

            const ws = new WebSocketImpl(this.#wsUrl);
            this.#ws = ws;

            const onOpen = () => {
                clearTimeout(timer);
                resolve();
            };
            const onError = () => {
                clearTimeout(timer);
                reject(new Error(`WebSocket connect failed: ${this.#wsUrl}`));
            };

            if ("addEventListener" in ws) {
                ws.addEventListener("open", onOpen, { once: true });
                ws.addEventListener("error", onError, { once: true });
                ws.addEventListener("message", (event) => this.#onMessage(String(event.data)));
            } else {
                ws.on("open", onOpen);
                ws.on("error", onError);
                ws.on("message", (data) => this.#onMessage(String(data)));
            }
        });
    }

    #onMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }
        if (message?.type !== "response" || message.id == null) {
            return;
        }

        const pending = this.#pending.get(String(message.id));
        if (pending == null) {
            return;
        }

        this.#pending.delete(String(message.id));
        clearTimeout(pending.timer);

        if (message.error != null) {
            const msg =
                typeof message.error.message === "string" ? message.error.message : JSON.stringify(message.error);
            pending.reject(new Error(msg));
            return;
        }

        pending.resolve(message.result);
    }

    request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
        if (this.#ws == null) {
            return Promise.reject(new Error("WebSocket is not connected"));
        }

        const id = String(this.#nextId++);
        const payload = JSON.stringify({ id, type: "request", method, params });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error(`WebSocket request timeout: ${method}`));
            }, timeoutMs);

            this.#pending.set(id, { resolve, reject, timer });

            if ("send" in this.#ws && typeof this.#ws.send === "function") {
                this.#ws.send(payload);
            } else {
                clearTimeout(timer);
                this.#pending.delete(id);
                reject(new Error("WebSocket send is unavailable"));
            }
        });
    }

    openTab(tabKey, url) {
        return this.request("openTab", { tabKey, url });
    }

    waitForSelector(tabKey, selector, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
        return this.request("waitForSelector", { tabKey, selector, timeoutMs });
    }

    click(tabKey, selector) {
        return this.request("click", { tabKey, selector });
    }

    closeTab(tabKey, tabId) {
        const params = { tabKey };
        if (typeof tabId === "number") {
            params.tabId = tabId;
        }
        return this.request("closeTab", params);
    }

    /**
     * Poll until selector exists (client-side retry when server uses short internal waits).
     */
    async pollForSelector(tabKey, selector, totalTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, pollIntervalMs = 500) {
        const deadline = Date.now() + totalTimeoutMs;
        let lastError = null;

        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                break;
            }
            try {
                await this.waitForSelector(tabKey, selector, Math.min(remaining, 5_000));
                return;
            } catch (error) {
                lastError = error;
                await sleep(pollIntervalMs);
            }
        }

        throw lastError ?? new Error(`Timeout waiting for selector: ${selector}`);
    }

    close() {
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error("WebSocket closed"));
        }
        this.#pending.clear();

        if (this.#ws == null) {
            return;
        }

        if ("close" in this.#ws && typeof this.#ws.close === "function") {
            this.#ws.close();
        }
        this.#ws = null;
    }
}
