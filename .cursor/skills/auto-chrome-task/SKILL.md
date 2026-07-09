---
name: auto-chrome-task
description: >-
  auto-chrome task and chrome-sidecar hub in target-supabase-sdk. Use when implementing
  or reviewing tasks/auto-chrome, chrome-ws-client.js, chrome-sidecar-hub.ts, post-task
  JSON, Chrome bridge not connected, bridge stability, hub.pingBridge, closeTab, tabKey/tabUrl,
  or WebSocket RPC to chrome-extension-starter SDK Bridge.
---

# auto-chrome task (target-supabase-sdk)

## One-line rule

**TaskNode talks JSON-RPC WebSocket to `pnpm chrome-sidecar`; hub forwards to the extension bridge, which runs tab RPC in the Service Worker.** Page UI stages must finish before the task clicks the next button; `closeTab` only after `done` + delay. **For batch runs, bridge must be stable before each task** (`waitForBridgeReady` + hub stable gate).

---

## Architecture

```text
pnpm worker (TaskNode)
  └── tasks/auto-chrome/auto-chrome.task.js
        └── ChromeWsClient → ws://127.0.0.1:9333 (chrome-sidecar-hub.ts)
              ├── hub.pingBridge (local — stability / health)
              └── extension offscreen WebSocket (role: bridge)
                    ├── ping → pong (extension offscreen)
                    └── SW: openTab | waitForSelector | click | closeTab
```

| Component | Path |
|-----------|------|
| Task | `tasks/auto-chrome/auto-chrome.task.js` |
| WS client | `tasks/auto-chrome/chrome-ws-client.js` |
| Example (tracked) | `tasks.example/auto-chrome/` |
| Hub | `scripts/chrome-sidecar-hub.ts` |
| Extension P0′ guide | `scripts/chrome-extension-bridge-stability.md` |
| Env | `CHROME_CONTROL_WS_URL` (default `ws://127.0.0.1:9333`) |

Hub URL must match extension `SDK_BRIDGE_WS_URL` (`chrome-extension-starter`).

---

## Dev session (order matters)

1. Extension: build → load `dist/` → Options → enable **SDK Bridge**
2. `pnpm chrome-sidecar` → log `Chrome bridge connected`
3. Wait **≥ `CHROME_BRIDGE_STABLE_MS`** with no `disconnected` in hub log
4. `pnpm worker`
5. `pnpm post-task -- --file tasks/auto-chrome/post-task.json`

PowerShell: prefer `--file` for JSON; single-quoted inline JSON strips quotes.

**Verbose logs:** `CHROME_HUB_VERBOSE=1` (hub), `CHROME_WS_VERBOSE=1` (task client).

---

## Task params

```json
{
  "tabKey": "amazon",
  "tabUrl": "https://www.amazon.com/...?tabKey=amazon",
  "wsUrl": "ws://127.0.0.1:9333",
  "closeTabDelayMs": 5000,
  "bridgeReadyTimeoutMs": 60000,
  "bridgeStableMs": 3000,
  "bridgePingIntervalMs": 2000,
  "rpcMaxAttempts": 3,
  "interTaskCooldownMs": 2000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `tabKey` | yes | — | Matches `#prepare-{tabKey}`, `#save-{tabKey}`, `#done-{tabKey}` |
| `tabUrl` | yes | — | Same `?tabKey=` as params |
| `wsUrl` | no | env / `9333` | Hub URL |
| `closeTabDelayMs` | no | `5000` | After `done` visible, before `closeTab` |
| `bridgeReadyTimeoutMs` | no | `60000` | `waitForBridgeReady` ceiling |
| `bridgeStableMs` | no | `3000` | Passed to client (hub enforces via `CHROME_BRIDGE_STABLE_MS`) |
| `bridgePingIntervalMs` | no | `2000` | Poll interval for `hub.pingBridge` |
| `rpcMaxAttempts` | no | `3` | Retries for bridge-transient RPC errors |
| `interTaskCooldownMs` | no | `2000` | Sleep after success before task returns (batch spacing) |

---

## Stage machine (must match extension page)

Amazon toolbar is **one visible button at a time** (see chrome-extension-starter skill `amazon-auto-chrome-page`).

```text
waitForBridgeReady (hub.pingBridge loop)
  → openTab
poll #prepare-{tabKey} visible
  → click prepare  (loadMoreProducts runs in page)
poll #save-{tabKey} visible
  → click save     (postAmazonDailyBestSellerProductList)
poll #done-{tabKey} visible
  → sleep(closeTabDelayMs)
  → closeTab(tabKey, tabId from openTab)
  → sleep(interTaskCooldownMs)
```

Task sets `allStagesComplete = true` only after `done`; **failure leaves tab open** for debugging.

---

## WebSocket protocol

**Request:** `{ id, type: "request", method, params }`  
**Response:** `{ id, type: "response", result? }` | `{ error: { message } }`

| Method | Params | Handler | Notes |
|--------|--------|---------|-------|
| `hub.pingBridge` | `{}` | **hub local** | `{ ok, uptimeMs, stableForMs, pingOk, pingLatencyMs? }` |
| `openTab` | `{ tabKey, url }` | extension | Returns `{ tabKey, tabId }` |
| `waitForSelector` | `{ tabKey, selector, timeoutMs? }` | extension | Visible + enabled |
| `click` | `{ tabKey, selector }` | extension | Fails if hidden/disabled |
| `closeTab` | `{ tabKey, tabId? }` | extension | Pass `tabId` from `openTab` |

**Bridge heartbeat (hub ↔ extension):** `{ type: "ping", ts }` → `{ type: "pong", ts }` on bridge socket (offscreen handles; see `scripts/chrome-extension-bridge-stability.md`).

`ChromeWsClient.pollForSelector` retries `waitForSelector` client-side (500ms interval).  
`requestWithRetry` retries hub/bridge transient errors (not selector/click business failures).

---

## Hub behavior (`chrome-sidecar-hub.ts`)

### Stability (P0)

| Feature | Env | Default |
|---------|-----|---------|
| Wait for bridge | `CHROME_BRIDGE_WAIT_MS` | `60000` |
| Stable uptime before forward | `CHROME_BRIDGE_STABLE_MS` | `3000` |
| Ping timeout | `CHROME_BRIDGE_PING_TIMEOUT_MS` | `5000` |
| Require pong for health | `CHROME_BRIDGE_PING_REQUIRED` | `false` |
| Verbose logs | `CHROME_HUB_VERBOSE` | off |

- Bridge registers: `{ type: "register", role: "bridge" }`
- Task requests wait for bridge **open** then **stable** before forward
- On bridge disconnect: **all in-flight requests rejected immediately** (no 120s hang)
- On controller disconnect: in-flight requests for that socket rejected
- `hub.pingBridge`: wait open + stable → optional ping → health result

### Logging

Hub logs connection ids (`c1`, `c2`), roles, request `id`/`method`, latency, bridge uptime, disconnect reasons, pending route counts. Use `CHROME_HUB_VERBOSE=1` for per-message debug.

---

## Client behavior (`chrome-ws-client.js`)

- `connect()` → `waitForBridgeReady()` → RPCs (task integration)
- `waitForBridgeReady({ timeoutMs, pingIntervalMs, stableMs })` polls `hub.pingBridge`
- `requestWithRetry(method, params, { maxAttempts, baseDelayMs })` — exponential backoff
- Retryable: bridge not connected/stable, disconnected during request, ping timeout, forward failure
- Logs: `[chrome-ws-client]`; verbose via `CHROME_WS_VERBOSE=1`

---

## Bridge stability (batch auto-chrome)

### Failure modes

| Symptom | Duration | Cause |
|---------|----------|-------|
| `Chrome bridge not connected` | ~20–60s | Extension asleep / not enabled / flapping |
| `Chrome bridge not stable` | varies | Connect/disconnect loop within stable window |
| `Chrome bridge disconnected during request` | fast | Bridge dropped mid-RPC (hub now fail-fast) |
| `WebSocket request timeout: openTab` | 120s | Extension hung on openTab (fix in extension) |

### Three-layer fix

1. **Extension (P0′)** — single WS, backoff reconnect, SW alarm keepalive, ping/pong → `scripts/chrome-extension-bridge-stability.md`
2. **Hub (P0)** — stable gate, disconnect reject pending, `hub.pingBridge`, logging
3. **Task (P1)** — `waitForBridgeReady`, `requestWithRetry`, `interTaskCooldownMs`

### Batch SOP

```text
1. Extension ON + reload dist/
2. pnpm chrome-sidecar — wait connected, 10s no disconnect
3. pnpm worker
4. Post tasks (worker serial per node)
5. On failure: check hub log for bridge uptime / stuck pending / flap count
```

---

## Pitfalls (real incidents)

### `Chrome bridge not connected` (~instant fail)

Extension bridge asleep or not enabled. Fix: offscreen bridge in extension, enable SDK Bridge, reload `dist/`, confirm sidecar log. Hub wait alone is not enough without extension fix.

### Bridge connect/disconnect loop

**Cause:** offscreen tight reconnect, SW killed, duplicate WS.  
**Fix:** extension P0′ (backoff + alarm). Hub stable gate reduces forwarding into flap window.

### Task hangs 120s on openTab

**Cause:** hub forwarded then bridge died; pending not cleared (old hub).  
**Fix:** hub rejects pending on disconnect; client retries or fails fast.

### Task clicks Save before Prepare finishes

**Cause:** `save` / `done` in DOM with `display:none`; old `waitForSelector` only checked presence.  
**Fix:** Page hides `save` until prepare done; extension waits visible+enabled; task polls next stage.

### Tab not closed after success

**Cause:** SW lost `tabKey → tabId`; `closeTab` returned `{ closed: false }`.  
**Fix:** `chrome.storage.session` registry; task passes `openedTabId`; close only when `allStagesComplete`.

### Tab closed too early

**Cause:** `finally` always called `closeTab` or no delay after `done`.  
**Fix:** `closeTab` only if `allStagesComplete`; default 5s after `done` visible.

### `active: true` steals focus

`openTab` uses foreground tab → taskbar flash. Use `active: false` in extension if silent background runs are desired.

### Task `extra` on failure

`task-node.ts` logs `extra` on finalize failure — surface WebSocket/selector errors there.

---

## Checklist when changing auto-chrome

1. Keep `tabKey` in `tabUrl` query and task params aligned.
2. Any new page stage → update poll/click order in `auto-chrome.task.js` and page toolbar in extension.
3. New hub method → hub handler, `chrome-ws-client.js`, this skill.
4. Sync `tasks.example/auto-chrome/` with `tasks/auto-chrome/`.
5. Rebuild extension + restart hub + worker after bridge changes.
6. Batch test: 10 tasks, hub `bridgeDisconnectCount` should not spike.

---

## Related

- Extension implementation: `D:/chrome-extension-starter` — `sdk-bridge-host.ts`, `hub-wire.ts`, `tab-control.ts`
- Extension bridge stability: `scripts/chrome-extension-bridge-stability.md` (supabase-sdk — **implemented in extension**)
- Extension offscreen: `chrome-extension-starter` `.cursor/skills/sdk-bridge-offscreen/SKILL.md`
- Amazon page buttons: `chrome-extension-starter` `.cursor/skills/amazon-auto-chrome-page/SKILL.md`
- Message routing: `chrome-extension-starter` `.cursor/skills/message-handler-registry/SKILL.md`
