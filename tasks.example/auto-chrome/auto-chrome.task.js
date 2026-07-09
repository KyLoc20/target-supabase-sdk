import { z } from "zod";
import { ChromeWsClient } from "./chrome-ws-client.js";

/**
 * auto-chrome — control the user's Chrome via WebSocket hub + chrome-extension-starter.
 *
 * Page stage machine (amazon toolbar — one visible button at a time):
 *   prepare (loadMoreProducts) → save (post list) → done (terminal)
 *
 * Task waits for each next button to become visible+enabled before clicking it.
 * closeTab runs only after done, plus closeTabDelayMs (default 5s).
 *
 * tabUrl must include ?tabKey= matching task params (e.g. ?tabKey=amazon).
 */
const autoChromeParamsSchema = z.object({
    tabKey: z.string().trim().min(1),
    tabUrl: z.string().url(),
    wsUrl: z.string().url().optional(),
    closeTabDelayMs: z.number().int().min(0).optional(),
    bridgeReadyTimeoutMs: z.number().int().min(1_000).optional(),
    bridgeStableMs: z.number().int().min(0).optional(),
    bridgePingIntervalMs: z.number().int().min(500).optional(),
    rpcMaxAttempts: z.number().int().min(1).max(10).optional(),
    interTaskCooldownMs: z.number().int().min(0).optional(),
});

const DEFAULT_CLOSE_TAB_DELAY_MS = 5_000;
const DEFAULT_BRIDGE_READY_TIMEOUT_MS = 60_000;
const DEFAULT_BRIDGE_STABLE_MS = 3_000;
const DEFAULT_BRIDGE_PING_INTERVAL_MS = 2_000;
const DEFAULT_RPC_MAX_ATTEMPTS = 3;
const DEFAULT_INTER_TASK_COOLDOWN_MS = 2_000;

function selector(id) {
    return `#${id}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function taskLog(message, extra) {
    if (extra != null) {
        console.log(`[auto-chrome] ${message}`, extra);
        return;
    }
    console.log(`[auto-chrome] ${message}`);
}

function taskWarn(message, extra) {
    if (extra != null) {
        console.warn(`[auto-chrome] ${message}`, extra);
        return;
    }
    console.warn(`[auto-chrome] ${message}`);
}

function resolveWsUrl(override) {
    const fromEnv = process.env.CHROME_CONTROL_WS_URL?.trim();
    return override ?? (fromEnv !== "" ? fromEnv : undefined) ?? "ws://127.0.0.1:9333";
}

function rpcOptions(maxAttempts) {
    return { maxAttempts };
}

export default {
    taskParamsValidator(params) {
        return autoChromeParamsSchema.safeParse(params).success;
    },

    async taskFn(params) {
        const start = Date.now();
        const parsed = autoChromeParamsSchema.parse(params);
        const {
            tabKey,
            tabUrl,
            wsUrl,
            closeTabDelayMs,
            bridgeReadyTimeoutMs,
            bridgeStableMs,
            bridgePingIntervalMs,
            rpcMaxAttempts,
            interTaskCooldownMs,
        } = parsed;

        const prepareSelector = selector(`prepare-${tabKey}`);
        const saveSelector = selector(`save-${tabKey}`);
        const doneSelector = selector(`done-${tabKey}`);
        const tabCloseDelay = closeTabDelayMs ?? DEFAULT_CLOSE_TAB_DELAY_MS;
        const readyTimeout = bridgeReadyTimeoutMs ?? DEFAULT_BRIDGE_READY_TIMEOUT_MS;
        const stableMs = bridgeStableMs ?? DEFAULT_BRIDGE_STABLE_MS;
        const pingIntervalMs = bridgePingIntervalMs ?? DEFAULT_BRIDGE_PING_INTERVAL_MS;
        const maxAttempts = rpcMaxAttempts ?? DEFAULT_RPC_MAX_ATTEMPTS;
        const cooldownMs = interTaskCooldownMs ?? DEFAULT_INTER_TASK_COOLDOWN_MS;
        const resolvedWsUrl = resolveWsUrl(wsUrl);
        const rpcOpts = rpcOptions(maxAttempts);

        taskLog("task started", {
            tabKey,
            tabUrl,
            wsUrl: resolvedWsUrl,
            bridgeReadyTimeoutMs: readyTimeout,
            bridgeStableMs: stableMs,
            rpcMaxAttempts: maxAttempts,
            interTaskCooldownMs: cooldownMs,
        });

        const client = new ChromeWsClient(resolvedWsUrl);
        let tabOpened = false;
        let allStagesComplete = false;
        /** @type {number | undefined} */
        let openedTabId;

        try {
            await client.connect();
            const bridgeHealth = await client.waitForBridgeReady({
                timeoutMs: readyTimeout,
                pingIntervalMs,
                stableMs,
            });
            taskLog("bridge ready", bridgeHealth);

            const opened = await client.openTab(tabKey, tabUrl, rpcOpts);
            openedTabId = typeof opened?.tabId === "number" ? opened.tabId : undefined;
            tabOpened = true;
            taskLog("tab opened", { tabKey, tabId: openedTabId });

            // Stage 1: prepare — wait until loadMoreProducts finishes (save becomes visible)
            taskLog("stage: waiting for prepare", { selector: prepareSelector });
            await client.pollForSelector(tabKey, prepareSelector);
            await client.click(tabKey, prepareSelector, rpcOpts);
            taskLog("stage: prepare clicked, waiting for save", { selector: saveSelector });
            await client.pollForSelector(tabKey, saveSelector);

            // Stage 2: save — wait until post completes (done becomes visible)
            await client.click(tabKey, saveSelector, rpcOpts);
            taskLog("stage: save clicked, waiting for done", { selector: doneSelector });
            await client.pollForSelector(tabKey, doneSelector);

            // Stage 3: done — terminal; allow page/extension to settle
            taskLog("stage: done visible, cooling down before closeTab", { closeTabDelayMs: tabCloseDelay });
            await sleep(tabCloseDelay);
            allStagesComplete = true;

            if (cooldownMs > 0) {
                taskLog("inter-task cooldown", { cooldownMs });
                await sleep(cooldownMs);
            }

            return {
                isSuccess: true,
                cost: Date.now() - start,
                extra: JSON.stringify({
                    tabKey,
                    tabUrl,
                    doneSelector,
                    closeTabDelayMs: tabCloseDelay,
                    bridgeHealth,
                    interTaskCooldownMs: cooldownMs,
                }),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            taskWarn("task failed", { tabKey, message, elapsedMs: Date.now() - start });
            return {
                isSuccess: false,
                cost: Date.now() - start,
                extra: message,
            };
        } finally {
            if (tabOpened && allStagesComplete) {
                try {
                    taskLog("closing tab", { tabKey, tabId: openedTabId });
                    await client.closeTab(tabKey, openedTabId, rpcOpts);
                } catch (closeError) {
                    taskWarn("closeTab failed (tab may already be closed)", {
                        tabKey,
                        error: closeError instanceof Error ? closeError.message : String(closeError),
                    });
                }
            } else if (tabOpened) {
                taskLog("leaving tab open for debugging", { tabKey, tabId: openedTabId, allStagesComplete });
            }
            client.close();
            taskLog("task finished", { tabKey, elapsedMs: Date.now() - start, allStagesComplete });
        }
    },
};
