import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.CHROME_CONTROL_WS_PORT ?? 9333);
const HOST = process.env.CHROME_CONTROL_WS_HOST ?? "127.0.0.1";

const BRIDGE_WAIT_MS = Number(process.env.CHROME_BRIDGE_WAIT_MS ?? 20_000);
const BRIDGE_POLL_MS = 200;

/** Chrome extension connection — executes openTab / waitForSelector / click */
let bridge: WebSocket | null = null;

/** request id → TaskNode client socket */
const pendingRoutes = new Map<string, WebSocket>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBridgeOpen(): boolean {
    return bridge != null && bridge.readyState === WebSocket.OPEN;
}

async function waitForBridge(timeoutMs = BRIDGE_WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (isBridgeOpen()) {
            return true;
        }
        await sleep(BRIDGE_POLL_MS);
    }
    return isBridgeOpen();
}

function registerBridge(ws: WebSocket): void {
    if (bridge != null && bridge !== ws && bridge.readyState === WebSocket.OPEN) {
        bridge.close();
    }
    bridge = ws;
    console.log("[chrome-hub] Chrome bridge connected");
    ws.on("close", () => {
        if (bridge === ws) {
            bridge = null;
            console.warn("[chrome-hub] Chrome bridge disconnected");
        }
    });
    sendJson(ws, { type: "registered", role: "bridge" });
}

function sendJson(ws: WebSocket, payload: unknown): void {
    ws.send(JSON.stringify(payload));
}

function rejectRequest(controller: WebSocket, id: string, message: string): void {
    sendJson(controller, { id, type: "response", error: { message } });
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("listening", () => {
    console.log(`[chrome-hub] listening on ws://${HOST}:${PORT}`);
    console.log("[chrome-hub] Load chrome-extension-starter dist/ in chrome://extensions");
    console.log("[chrome-hub] Expect: Chrome bridge connected");
});

wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
        let message: {
            id?: string;
            type?: string;
            role?: string;
            method?: string;
        };
        try {
            message = JSON.parse(String(raw));
        } catch {
            return;
        }

        if (message.type === "register" && message.role === "bridge") {
            registerBridge(ws);
            return;
        }

        if (message.type === "request" && message.id != null) {
            void (async () => {
                if (!isBridgeOpen()) {
                    console.log(`[chrome-hub] waiting up to ${BRIDGE_WAIT_MS}ms for Chrome bridge…`);
                    const ready = await waitForBridge();
                    if (!ready) {
                        rejectRequest(
                            ws,
                            message.id!,
                            "Chrome bridge not connected. Enable SDK Bridge in extension options, reload dist/, and wait for hub to show Chrome bridge connected.",
                        );
                        return;
                    }
                }
                pendingRoutes.set(message.id!, ws);
                bridge?.send(String(raw));
            })();
            return;
        }

        if (message.type === "response" && message.id != null) {
            const controller = pendingRoutes.get(message.id);
            if (controller != null) {
                pendingRoutes.delete(message.id);
                controller.send(String(raw));
            }
        }
    });
});

process.on("SIGINT", () => {
    console.log("[chrome-hub] shutting down");
    wss.close();
    process.exit(0);
});
