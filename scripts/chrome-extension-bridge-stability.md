# Extension bridge stability (P0′) — chrome-extension-starter

**Status:** Implemented in `D:/chrome-extension-starter` (see `.cursor/skills/sdk-bridge-offscreen/SKILL.md`).

Hub and task client in supabase-sdk support `ping`/`pong` and `hub.pingBridge`.

## Implemented in extension

| Change | File |
|--------|------|
| Exponential backoff reconnect (1s → 30s, unlimited) | `src/offscreen/sdk-bridge-host.ts`, `hub-client.ts` |
| ping/pong on bridge socket | `src/background/sdk-bridge/hub-wire.ts` |
| SW alarm ~30s + ensure offscreen | `src/background/sdk-bridge/hub-client.ts` |
| `openTab` tab reuse, `active: false`, 90s load timeout | `src/background/sdk-bridge/tab-control.ts` |
| Constants | `src/background/sdk-bridge/constants.ts` |

## Verify

1. `pnpm chrome-sidecar` with `CHROME_HUB_VERBOSE=1` (supabase-sdk)
2. `pnpm build` + reload extension `dist/` in Chrome
3. Hub: `Chrome bridge connected`, `bridge pong received` when task runs `hub.pingBridge`
4. Task log: `bridge ready` with `pingOk: true`
5. Batch 10 auto-chrome tasks: ≥9 success

## Env alignment

| Extension | Hub / task |
|-----------|------------|
| `SDK_BRIDGE_WS_URL` (`constants.ts`) | `CHROME_CONTROL_WS_URL` |
| `SDK_BRIDGE_RECONNECT_MAX_MS=30000` | `CHROME_BRIDGE_WAIT_MS=60000` |

Optional: set `CHROME_BRIDGE_PING_REQUIRED=1` on hub after verifying pong works.
