import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.CHROME_CONTROL_WS_PORT ?? 9333);
const HOST = process.env.CHROME_CONTROL_WS_HOST ?? "127.0.0.1";

const BRIDGE_WAIT_MS = Number(process.env.CHROME_BRIDGE_WAIT_MS ?? 60_000);
const BRIDGE_STABLE_MS = Number(process.env.CHROME_BRIDGE_STABLE_MS ?? 3_000);
const BRIDGE_POLL_MS = 200;
const BRIDGE_PING_TIMEOUT_MS = Number(process.env.CHROME_BRIDGE_PING_TIMEOUT_MS ?? 5_000);
const BRIDGE_PING_REQUIRED =
    process.env.CHROME_BRIDGE_PING_REQUIRED === "1" || process.env.CHROME_BRIDGE_PING_REQUIRED === "true";
const VERBOSE = process.env.CHROME_HUB_VERBOSE === "1" || process.env.CHROME_HUB_VERBOSE === "true";

/** Chrome extension connection — executes openTab / waitForSelector / click */
let bridge: WebSocket | null = null;
let bridgeConnId: string | null = null;
let bridgeConnectedAt: number | null = null;

/** request id → TaskNode client socket */
const pendingRoutes = new Map<string, WebSocket>();
/** request id → hub receive time (for latency logging) */
const pendingStartedAt = new Map<string, number>();
/** request id → RPC method */
const pendingMethods = new Map<string, string>();

let connSeq = 0;
let bridgeDisconnectCount = 0;

type ConnRole = "unknown" | "bridge" | "controller";

interface ConnMeta {
    id: string;
    role: ConnRole;
    remote: string;
    connectedAt: number;
}

interface PendingPing {
    ts: number;
    resolve: (value: { ts: number; latencyMs: number }) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const connMeta = new WeakMap<WebSocket, ConnMeta>();
let pendingPing: PendingPing | null = null;

function log(message: string, extra?: Record<string, unknown>): void {
    if (extra != null) {
        console.log(`[chrome-hub] ${message}`, extra);
        return;
    }
    console.log(`[chrome-hub] ${message}`);
}

function warn(message: string, extra?: Record<string, unknown>): void {
    if (extra != null) {
        console.warn(`[chrome-hub] ${message}`, extra);
        return;
    }
    console.warn(`[chrome-hub] ${message}`);
}

function debug(message: string, extra?: Record<string, unknown>): void {
    if (!VERBOSE) {
        return;
    }
    log(`[verbose] ${message}`, extra);
}

function readyStateLabel(ws: WebSocket | null): string {
    if (ws == null) {
        return "null";
    }
    switch (ws.readyState) {
        case WebSocket.CONNECTING:
            return "CONNECTING";
        case WebSocket.OPEN:
            return "OPEN";
        case WebSocket.CLOSING:
            return "CLOSING";
        case WebSocket.CLOSED:
            return "CLOSED";
        default:
            return String(ws.readyState);
    }
}

function peerLabel(req: IncomingMessage): string {
    const remote = req.socket.remoteAddress ?? "?";
    const port = req.socket.remotePort;
    return port != null ? `${remote}:${port}` : remote;
}

function metaOf(ws: WebSocket): ConnMeta | undefined {
    return connMeta.get(ws);
}

function connLabel(ws: WebSocket): string {
    const meta = metaOf(ws);
    if (meta == null) {
        return "unknown";
    }
    return `${meta.id}(${meta.role})`;
}

function bridgeUptimeMs(): number | null {
    if (bridgeConnectedAt == null) {
        return null;
    }
    return Date.now() - bridgeConnectedAt;
}

function hubStats(): Record<string, unknown> {
    return {
        bridge: bridgeConnId ?? "none",
        bridgeState: readyStateLabel(bridge),
        bridgeUptimeMs: bridgeUptimeMs(),
        bridgeDisconnectCount,
        pendingRequests: pendingRoutes.size,
        controllers: countConnectionsByRole("controller"),
    };
}

function countConnectionsByRole(role: ConnRole): number {
    let count = 0;
    for (const client of wss.clients) {
        const meta = metaOf(client);
        if (meta?.role === role) {
            count += 1;
        }
    }
    return count;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBridgeOpen(): boolean {
    return bridge != null && bridge.readyState === WebSocket.OPEN;
}

function isBridgeStable(stableMs = BRIDGE_STABLE_MS): boolean {
    const uptimeMs = bridgeUptimeMs();
    return isBridgeOpen() && uptimeMs != null && uptimeMs >= stableMs;
}

async function waitForBridge(timeoutMs = BRIDGE_WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const waitStartedAt = Date.now();
    let polls = 0;

    while (Date.now() < deadline) {
        if (isBridgeOpen()) {
            const waitedMs = Date.now() - waitStartedAt;
            log("bridge became ready", {
                waitedMs,
                polls,
                bridge: bridgeConnId,
                uptimeMs: bridgeUptimeMs(),
            });
            return true;
        }
        polls += 1;
        await sleep(BRIDGE_POLL_MS);
    }

    const waitedMs = Date.now() - waitStartedAt;
    warn("bridge wait timed out", {
        waitedMs,
        timeoutMs,
        polls,
        bridgeState: readyStateLabel(bridge),
        ...hubStats(),
    });
    return isBridgeOpen();
}

async function waitForBridgeStable(stableMs = BRIDGE_STABLE_MS, timeoutMs = BRIDGE_WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const waitStartedAt = Date.now();
    let polls = 0;

    while (Date.now() < deadline) {
        if (!isBridgeOpen()) {
            polls += 1;
            await sleep(BRIDGE_POLL_MS);
            continue;
        }

        const uptimeMs = bridgeUptimeMs();
        if (uptimeMs != null && uptimeMs >= stableMs) {
            const waitedMs = Date.now() - waitStartedAt;
            log("bridge is stable", {
                waitedMs,
                polls,
                stableMs,
                uptimeMs,
                bridge: bridgeConnId,
            });
            return true;
        }

        polls += 1;
        await sleep(BRIDGE_POLL_MS);
    }

    const waitedMs = Date.now() - waitStartedAt;
    warn("bridge stable wait timed out", {
        waitedMs,
        timeoutMs,
        stableMs,
        polls,
        bridgeUptimeMs: bridgeUptimeMs(),
        bridgeState: readyStateLabel(bridge),
        ...hubStats(),
    });
    return isBridgeStable(stableMs);
}

function clearPendingRoute(requestId: string): void {
    pendingRoutes.delete(requestId);
    pendingStartedAt.delete(requestId);
    pendingMethods.delete(requestId);
}

function clearPendingPing(reason: string): void {
    if (pendingPing == null) {
        return;
    }
    clearTimeout(pendingPing.timer);
    pendingPing.reject(new Error(reason));
    pendingPing = null;
}

function rejectAllPendingRoutes(message: string, context?: Record<string, unknown>): void {
    const entries = [...pendingRoutes.entries()];
    if (entries.length === 0) {
        return;
    }

    warn("rejecting all in-flight requests", {
        count: entries.length,
        message,
        requests: entries.map(([id]) => ({
            id,
            method: pendingMethods.get(id),
            controller: connLabel(pendingRoutes.get(id)!),
        })),
        ...context,
        ...hubStats(),
    });

    for (const [requestId, controller] of entries) {
        const method = pendingMethods.get(requestId);
        rejectRequest(controller, requestId, message, { method, cause: context?.cause });
    }
}

function handleBridgePong(message: { type?: string; ts?: number }): void {
    if (pendingPing == null || message.type !== "pong") {
        return;
    }

    const latencyMs = Date.now() - pendingPing.ts;
    log("bridge pong received", {
        latencyMs,
        bridge: bridgeConnId,
        bridgeUptimeMs: bridgeUptimeMs(),
    });
    clearTimeout(pendingPing.timer);
    pendingPing.resolve({ ts: message.ts ?? pendingPing.ts, latencyMs });
    pendingPing = null;
}

function pingBridge(timeoutMs = BRIDGE_PING_TIMEOUT_MS): Promise<{ ts: number; latencyMs: number }> {
    if (!isBridgeOpen() || bridge == null) {
        return Promise.reject(new Error("Chrome bridge not connected"));
    }

    if (pendingPing != null) {
        return Promise.reject(new Error("Bridge ping already in progress"));
    }

    const ts = Date.now();
    log("sending bridge ping", { ts, timeoutMs, bridge: bridgeConnId });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (pendingPing == null) {
                return;
            }
            pendingPing = null;
            warn("bridge ping timed out", {
                timeoutMs,
                bridge: bridgeConnId,
                bridgeUptimeMs: bridgeUptimeMs(),
                bridgeState: readyStateLabel(bridge),
            });
            reject(new Error(`Bridge ping timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingPing = { ts, resolve, reject, timer };
        sendJson(bridge, { type: "ping", ts });
    });
}

async function probeBridgeHealth(stableMs = BRIDGE_STABLE_MS): Promise<{
    ok: boolean;
    uptimeMs: number;
    stableForMs: number;
    pingOk: boolean;
    pingLatencyMs?: number;
}> {
    const uptimeMs = bridgeUptimeMs() ?? 0;
    const stableForMs = uptimeMs;

    if (!isBridgeStable(stableMs)) {
        throw new Error(
            `Chrome bridge not stable (uptime ${uptimeMs}ms, need ${stableMs}ms). Extension may be reconnecting.`,
        );
    }

    try {
        const pong = await pingBridge();
        return {
            ok: true,
            uptimeMs,
            stableForMs,
            pingOk: true,
            pingLatencyMs: pong.latencyMs,
        };
    } catch (error) {
        if (!isBridgeOpen()) {
            throw new Error("Chrome bridge disconnected during ping");
        }

        if (BRIDGE_PING_REQUIRED) {
            throw error instanceof Error ? error : new Error(String(error));
        }

        warn("bridge ping failed but bridge still open — continuing (update extension for pong support)", {
            error: error instanceof Error ? error.message : String(error),
            bridge: bridgeConnId,
            uptimeMs,
            pingRequired: BRIDGE_PING_REQUIRED,
        });

        return {
            ok: true,
            uptimeMs,
            stableForMs,
            pingOk: false,
        };
    }
}

function sendJson(ws: WebSocket, payload: unknown): void {
    ws.send(JSON.stringify(payload));
}

function sendResponse(controller: WebSocket, id: string, result: unknown): void {
    log("sending hub response", {
        id,
        controller: connLabel(controller),
        ok: true,
    });
    sendJson(controller, { id, type: "response", result });
}

function rejectRequest(controller: WebSocket, id: string, message: string, context?: Record<string, unknown>): void {
    clearPendingRoute(id);
    warn("rejecting request", {
        id,
        controller: connLabel(controller),
        message,
        ...context,
        ...hubStats(),
    });
    sendJson(controller, { id, type: "response", error: { message } });
}

async function handleHubPingBridge(controller: WebSocket, requestId: string): Promise<void> {
    log("hub.pingBridge requested", {
        requestId,
        controller: connLabel(controller),
        ...hubStats(),
    });

    if (!isBridgeOpen()) {
        log(`waiting up to ${BRIDGE_WAIT_MS}ms for Chrome bridge (hub.pingBridge)`, {
            requestId,
            ...hubStats(),
        });
        const ready = await waitForBridge();
        if (!ready) {
            rejectRequest(controller, requestId, "Chrome bridge not connected", { method: "hub.pingBridge" });
            return;
        }
    }

    const stable = await waitForBridgeStable();
    if (!stable) {
        rejectRequest(controller, requestId, "Chrome bridge not stable", { method: "hub.pingBridge" });
        return;
    }

    try {
        const health = await probeBridgeHealth();
        sendResponse(controller, requestId, health);
    } catch (error) {
        rejectRequest(controller, requestId, error instanceof Error ? error.message : String(error), {
            method: "hub.pingBridge",
        });
    }
}

function registerBridge(ws: WebSocket): void {
    const meta = metaOf(ws);
    if (meta != null) {
        meta.role = "bridge";
    }

    const previousConnId = bridgeConnId;
    const previousUptimeMs = bridgeUptimeMs();
    const oldBridge = bridge;

    bridge = ws;
    bridgeConnId = meta?.id ?? "unknown";
    bridgeConnectedAt = Date.now();

    if (oldBridge != null && oldBridge !== ws && oldBridge.readyState === WebSocket.OPEN) {
        warn("replacing existing bridge connection", {
            previous: previousConnId,
            previousUptimeMs,
            incoming: meta?.id,
            ...hubStats(),
        });
        oldBridge.close();
    }

    log("Chrome bridge connected", {
        bridge: bridgeConnId,
        remote: meta?.remote,
        replaced: previousConnId,
        ...hubStats(),
    });

    ws.on("message", (raw) => {
        const rawText = String(raw);
        let message: {
            id?: string;
            type?: string;
            ts?: number;
            error?: { message?: string };
            method?: string;
        };

        try {
            message = JSON.parse(rawText);
        } catch (error) {
            warn("invalid JSON from bridge", {
                bridge: bridgeConnId,
                preview: rawText.slice(0, 200),
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        debug("bridge message", {
            bridge: bridgeConnId,
            type: message.type,
            id: message.id,
        });

        if (message.type === "pong") {
            handleBridgePong(message);
            return;
        }

        if (message.type === "response" && message.id != null) {
            routeBridgeResponse(message.id, rawText, message);
        }
    });

    ws.on("close", (code, reason) => {
        if (bridge !== ws) {
            debug("stale bridge socket closed", {
                conn: meta?.id,
                code,
                reason: reason.toString() || "(empty)",
            });
            return;
        }

        const uptimeMs = bridgeUptimeMs();
        bridgeDisconnectCount += 1;
        bridge = null;
        bridgeConnId = null;
        bridgeConnectedAt = null;
        clearPendingPing("Chrome bridge disconnected during ping");

        const stuckPending = pendingRoutes.size;
        warn("Chrome bridge disconnected", {
            bridge: meta?.id,
            code,
            reason: reason.toString() || "(empty)",
            uptimeMs,
            bridgeDisconnectCount,
            stuckPendingRequests: stuckPending,
            ...hubStats(),
        });

        rejectAllPendingRoutes("Chrome bridge disconnected during request", {
            cause: "bridge_disconnect",
            code,
            reason: reason.toString() || "(empty)",
        });
    });

    sendJson(ws, { type: "registered", role: "bridge" });
}

function routeBridgeResponse(
    requestId: string,
    rawText: string,
    message: { error?: { message?: string }; method?: string },
): void {
    const controller = pendingRoutes.get(requestId);
    const startedAt = pendingStartedAt.get(requestId);
    const method = pendingMethods.get(requestId);
    const latencyMs = startedAt != null ? Date.now() - startedAt : undefined;

    if (controller != null) {
        clearPendingRoute(requestId);
        const hasError = message.error != null;
        log("routing response to controller", {
            requestId,
            method,
            latencyMs,
            controller: connLabel(controller),
            ok: !hasError,
            error: message.error?.message,
            pendingRequests: pendingRoutes.size,
        });
        controller.send(rawText);
        return;
    }

    warn("orphan response from bridge (no pending route)", {
        requestId,
        method,
        hasError: message.error != null,
        error: message.error?.message,
        ...hubStats(),
    });
}

function attachConnection(ws: WebSocket, req: IncomingMessage): void {
    const id = `c${++connSeq}`;
    const meta: ConnMeta = {
        id,
        role: "unknown",
        remote: peerLabel(req),
        connectedAt: Date.now(),
    };
    connMeta.set(ws, meta);

    log("socket connected", {
        conn: id,
        remote: meta.remote,
        ...hubStats(),
    });

    ws.on("close", (code, reason) => {
        const role = meta.role;
        const lifetimeMs = Date.now() - meta.connectedAt;
        log("socket disconnected", {
            conn: id,
            role,
            remote: meta.remote,
            code,
            reason: reason.toString() || "(empty)",
            lifetimeMs,
            ...hubStats(),
        });

        if (role === "controller") {
            for (const [requestId, controller] of pendingRoutes) {
                if (controller === ws) {
                    warn("controller disconnected with in-flight request", {
                        requestId,
                        method: pendingMethods.get(requestId),
                        conn: id,
                    });
                    rejectRequest(controller, requestId, "Controller disconnected during request", {
                        method: pendingMethods.get(requestId),
                        cause: "controller_disconnect",
                    });
                }
            }
        }
    });
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("listening", () => {
    log(`listening on ws://${HOST}:${PORT}`, {
        bridgeWaitMs: BRIDGE_WAIT_MS,
        bridgeStableMs: BRIDGE_STABLE_MS,
        bridgePollMs: BRIDGE_POLL_MS,
        bridgePingTimeoutMs: BRIDGE_PING_TIMEOUT_MS,
        bridgePingRequired: BRIDGE_PING_REQUIRED,
        verbose: VERBOSE,
    });
    log("Load chrome-extension-starter dist/ in chrome://extensions");
    log("Expect: Chrome bridge connected (stable after bridgeStableMs)");
});

wss.on("connection", (ws, req) => {
    attachConnection(ws, req);

    ws.on("message", (raw) => {
        const rawText = String(raw);
        let message: {
            id?: string;
            type?: string;
            role?: string;
            method?: string;
            error?: { message?: string };
            result?: unknown;
        };

        try {
            message = JSON.parse(rawText);
        } catch (error) {
            warn("invalid JSON from socket", {
                conn: connLabel(ws),
                preview: rawText.slice(0, 200),
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        debug("message received", {
            conn: connLabel(ws),
            type: message.type,
            id: message.id,
            method: message.method,
            role: message.role,
        });

        const conn = metaOf(ws);
        if (conn?.role === "bridge") {
            return;
        }

        if (message.type === "register" && message.role === "bridge") {
            registerBridge(ws);
            return;
        }

        if (message.type === "request" && message.id != null) {
            const meta = metaOf(ws);
            if (meta != null && meta.role === "unknown") {
                meta.role = "controller";
                log("controller identified", { conn: meta.id, remote: meta.remote });
            }

            const requestId = message.id;
            const method = message.method ?? "(unknown)";

            if (method === "hub.pingBridge") {
                void handleHubPingBridge(ws, requestId);
                return;
            }

            void (async () => {
                if (!isBridgeOpen()) {
                    log(`waiting up to ${BRIDGE_WAIT_MS}ms for Chrome bridge`, {
                        requestId,
                        method,
                        controller: connLabel(ws),
                        ...hubStats(),
                    });
                    const ready = await waitForBridge();
                    if (!ready) {
                        rejectRequest(
                            ws,
                            requestId,
                            "Chrome bridge not connected. Enable SDK Bridge in extension options, reload dist/, and wait for hub to show Chrome bridge connected.",
                            { method },
                        );
                        return;
                    }
                }

                if (!isBridgeStable()) {
                    log(`waiting for bridge stability (${BRIDGE_STABLE_MS}ms uptime)`, {
                        requestId,
                        method,
                        bridgeUptimeMs: bridgeUptimeMs(),
                        ...hubStats(),
                    });
                    const stable = await waitForBridgeStable();
                    if (!stable) {
                        rejectRequest(
                            ws,
                            requestId,
                            `Chrome bridge not stable (need ${BRIDGE_STABLE_MS}ms connected). Extension may be reconnecting.`,
                            { method },
                        );
                        return;
                    }
                }

                pendingRoutes.set(requestId, ws);
                pendingStartedAt.set(requestId, Date.now());
                pendingMethods.set(requestId, method);

                log("forwarding request to bridge", {
                    requestId,
                    method,
                    controller: connLabel(ws),
                    bridge: bridgeConnId,
                    bridgeUptimeMs: bridgeUptimeMs(),
                    pendingRequests: pendingRoutes.size,
                });

                try {
                    bridge?.send(rawText);
                } catch (error) {
                    clearPendingRoute(requestId);
                    rejectRequest(ws, requestId, "Failed to forward request to Chrome bridge.", {
                        method,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            })();
            return;
        }

        if (message.type === "response" && message.id != null) {
            routeBridgeResponse(message.id, rawText, message);
            return;
        }

        if (message.type === "pong") {
            handleBridgePong(message);
            return;
        }

        warn("unhandled message", {
            conn: connLabel(ws),
            type: message.type,
            id: message.id,
            method: message.method,
            role: message.role,
        });
    });
});

process.on("SIGINT", () => {
    log("shutting down", hubStats());
    rejectAllPendingRoutes("Hub shutting down", { cause: "shutdown" });
    wss.close();
    process.exit(0);
});
