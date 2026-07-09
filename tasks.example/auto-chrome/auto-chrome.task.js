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
});

const DEFAULT_CLOSE_TAB_DELAY_MS = 5_000;

function selector(id) {
    return `#${id}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWsUrl(override) {
    const fromEnv = process.env.CHROME_CONTROL_WS_URL?.trim();
    return override ?? (fromEnv !== "" ? fromEnv : undefined) ?? "ws://127.0.0.1:9333";
}

export default {
    taskParamsValidator(params) {
        return autoChromeParamsSchema.safeParse(params).success;
    },

    async taskFn(params) {
        const start = Date.now();
        const { tabKey, tabUrl, wsUrl, closeTabDelayMs } = autoChromeParamsSchema.parse(params);
        const prepareSelector = selector(`prepare-${tabKey}`);
        const saveSelector = selector(`save-${tabKey}`);
        const doneSelector = selector(`done-${tabKey}`);
        const tabCloseDelay = closeTabDelayMs ?? DEFAULT_CLOSE_TAB_DELAY_MS;

        const client = new ChromeWsClient(resolveWsUrl(wsUrl));
        let tabOpened = false;
        let allStagesComplete = false;
        /** @type {number | undefined} */
        let openedTabId;

        try {
            await client.connect();
            const opened = await client.openTab(tabKey, tabUrl);
            openedTabId = typeof opened?.tabId === "number" ? opened.tabId : undefined;
            tabOpened = true;

            // Stage 1: prepare — wait until loadMoreProducts finishes (save becomes visible)
            await client.pollForSelector(tabKey, prepareSelector);
            await client.click(tabKey, prepareSelector);
            await client.pollForSelector(tabKey, saveSelector);

            // Stage 2: save — wait until post completes (done becomes visible)
            await client.click(tabKey, saveSelector);
            await client.pollForSelector(tabKey, doneSelector);

            // Stage 3: done — terminal; allow page/extension to settle
            await sleep(tabCloseDelay);
            allStagesComplete = true;

            return {
                isSuccess: true,
                cost: Date.now() - start,
                extra: JSON.stringify({
                    tabKey,
                    tabUrl,
                    doneSelector,
                    closeTabDelayMs: tabCloseDelay,
                }),
            };
        } catch (error) {
            return {
                isSuccess: false,
                cost: Date.now() - start,
                extra: error instanceof Error ? error.message : String(error),
            };
        } finally {
            if (tabOpened && allStagesComplete) {
                try {
                    await client.closeTab(tabKey, openedTabId);
                } catch {
                    // Tab may already be closed by the user.
                }
            }
            client.close();
        }
    },
};
