---
name: auto-chrome-task
description: >-
  auto-chrome task and chrome-sidecar hub in target-supabase-sdk. Use when implementing
  or reviewing tasks/auto-chrome, chrome-ws-client.js, chrome-sidecar-hub.ts, post-task
  JSON, Chrome bridge not connected, closeTab, tabKey/tabUrl, or WebSocket RPC to
  chrome-extension-starter SDK Bridge.
---

# auto-chrome task (target-supabase-sdk)

## One-line rule

**TaskNode talks JSON-RPC WebSocket to `pnpm chrome-sidecar`; hub forwards to the extension bridge, which runs tab RPC in the Service Worker.** Page UI stages must finish before the task clicks the next button; `closeTab` only after `done` + delay.

---

## Architecture

```text
pnpm worker (TaskNode)
  └── tasks/auto-chrome/auto-chrome.task.js
        └── ChromeWsClient → ws://127.0.0.1:9333 (chrome-sidecar-hub.ts)
              └── extension offscreen WebSocket (role: bridge)
                    └── SW: openTab | waitForSelector | click | closeTab
```

| Component | Path |
|-----------|------|
| Task | `tasks/auto-chrome/auto-chrome.task.js` |
| WS client | `tasks/auto-chrome/chrome-ws-client.js` |
| Example payload | `tasks/auto-chrome/post-task.json` |
| Hub | `scripts/chrome-sidecar-hub.ts` |
| Env | `CHROME_CONTROL_WS_URL` (default `ws://127.0.0.1:9333`) |

Hub URL must match extension `SDK_BRIDGE_WS_URL` (`chrome-extension-starter`).

---

## Dev session (order matters)

1. Extension: build → load `dist/` → Options → enable **SDK Bridge**
2. `pnpm chrome-sidecar` → log `Chrome bridge connected`
3. `pnpm worker`
4. `pnpm post-task -- --file tasks/auto-chrome/post-task.json`

PowerShell: prefer `--file` for JSON; single-quoted inline JSON strips quotes.

---

## Task params

```json
{
  "tabKey": "amazon",
  "tabUrl": "https://www.amazon.com/...?tabKey=amazon",
  "wsUrl": "ws://127.0.0.1:9333",
  "closeTabDelayMs": 5000
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `tabKey` | yes | Matches `#prepare-{tabKey}`, `#save-{tabKey}`, `#done-{tabKey}` on page |
| `tabUrl` | yes | Must include same `?tabKey=` so extension page resolves selectors |
| `wsUrl` | no | Overrides env / default hub |
| `closeTabDelayMs` | no | Default 5000; wait after `done` visible before `closeTab` |

---

## Stage machine (must match extension page)

Amazon toolbar is **one visible button at a time** (see chrome-extension-starter skill `amazon-auto-chrome-page`).

```text
poll #prepare-{tabKey} visible
  → click prepare  (loadMoreProducts runs in page)
poll #save-{tabKey} visible   ← prepare finished; do NOT click save before this
  → click save     (postAmazonDailyBestSellerProductList)
poll #done-{tabKey} visible   ← save finished
  → sleep(closeTabDelayMs)
  → closeTab(tabKey, tabId from openTab)
```

Task sets `allStagesComplete = true` only after `done`; **failure leaves tab open** for debugging.

---

## WebSocket protocol

**Request:** `{ id, type: "request", method, params }`  
**Response:** `{ id, type: "response", result? }` | `{ error: { message } }`

| Method | Params | Notes |
|--------|--------|-------|
| `openTab` | `{ tabKey, url }` | Returns `{ tabKey, tabId }`; extension waits `status === complete` |
| `waitForSelector` | `{ tabKey, selector, timeoutMs? }` | Extension checks **visible + enabled**, not DOM presence only |
| `click` | `{ tabKey, selector }` | Fails if hidden/disabled |
| `closeTab` | `{ tabKey, tabId? }` | Pass `tabId` from `openTab`; SW may restart and lose in-memory map |

`ChromeWsClient.pollForSelector` retries `waitForSelector` client-side (500ms interval).

---

## Hub behavior (`chrome-sidecar-hub.ts`)

- Bridge registers: `{ type: "register", role: "bridge" }`
- Task requests wait up to `CHROME_BRIDGE_WAIT_MS` (default 20s) for bridge
- Responses routed by request `id`

---

## Pitfalls (real incidents)

### `Chrome bridge not connected` (~instant fail)

Extension bridge asleep or not enabled. Fix: offscreen bridge in extension, enable SDK Bridge, reload `dist/`, confirm sidecar log. Hub wait alone is not enough without extension fix.

### Task clicks Save before Prepare finishes

**Cause:** `save` / `done` existed in DOM with `display:none`; old `waitForSelector` only checked `querySelector != null`.  
**Fix:** Page hides `save` until prepare done; extension waits visible+enabled; task polls next stage button.

### Tab not closed after success

**Cause:** SW lost `tabKey → tabId` between RPCs; `closeTab` returned `{ closed: false }` silently.  
**Fix:** Extension `chrome.storage.session` registry; task passes `openedTabId` to `closeTab`; close only when `allStagesComplete`.

### Tab closed too early

**Cause:** `finally` always called `closeTab` or no delay after `done`.  
**Fix:** `closeTab` only if `allStagesComplete`; default 5s after `done` visible.

### `active: true` steals focus

`openTab` uses foreground tab → taskbar flash. Use `active: false` in extension if silent background runs are desired (trade-off: possible background throttling).

### Task `extra` on failure

`task-node.ts` logs `extra` on finalize failure — surface WebSocket/selector errors there.

---

## Checklist when changing auto-chrome

1. Keep `tabKey` in `tabUrl` query and task params aligned.
2. Any new page stage → update poll/click order in `auto-chrome.task.js` and page toolbar in extension.
3. New hub method → `types.ts`, `hub-request-handler.ts`, `chrome-ws-client.js`, hub comment.
4. Sync `tasks.example/auto-chrome/`.
5. Rebuild extension + restart worker after task or bridge changes.

---

## Related

- Extension bridge + offscreen: `chrome-extension-starter` `.cursor/skills/sdk-bridge-offscreen/SKILL.md`
- Amazon page buttons: `chrome-extension-starter` `.cursor/skills/amazon-auto-chrome-page/SKILL.md`
- Message routing (popup/options): `chrome-extension-starter` `.cursor/skills/message-handler-registry/SKILL.md`
