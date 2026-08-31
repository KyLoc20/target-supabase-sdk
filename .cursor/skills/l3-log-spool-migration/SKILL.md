---
name: l3-log-spool-migration
description: >-
  Migrate L3 services (watch/download/log/upload/cv/gc) from log-persist registry
  coordinator to file log spool after target-supabase-sdk breaking API removal.
  Use when updating startup/log-persist.ts, waitForAllProcessesReady, or
  ensureLogPersistFromEnv in downstream repos.
---

# L3 log-spool migration (downstream services)

SDK reference: [`src/shared/log/README.md`](../../src/shared/log/README.md), [log-spool](../log-spool/SKILL.md).

## Why the first “migration” still broke

| What was done | What was missed |
|---------------|-----------------|
| SDK switched to file spool; removed `createLogPersistCoordinator`, `waitForLogPersistReady`, etc. | **All L3 repos** still imported removed symbols |
| Skills/docs updated in supabase-sdk | **No grep pass** on `D:/*-service` before deleting deprecated APIs |
| log-service `node_modules` linked to new SDK **src** | **log-service `src/` + `dist/`** still used old `startup/log-persist.ts` |
| Spool no-op `waitForLogPersistReady` existed briefly | Then removed entirely — downstream **must** delete the gate |

**Rule:** SDK log-spool ship is **not done** until every `file:../supabase-sdk` consumer builds clean and drops registry readiness.

---

## Migration checklist (per service)

### 1. Import SDK lifecycle helpers (delete `startup/log-persist.ts` / `log-spool.ts`)

```typescript
import {
  enableLogSpoolFromEnvInChild,
  isLogSpoolEnabled,
  getMainLogSpoolWriterStats,
  shutdownLogSpool,
} from "target-supabase-sdk/node";
```

No local wrapper file — use SDK `service-lifecycle` exports directly.

### 2. Main `index.ts` (`createServiceHost`)

| Remove | Keep |
|--------|------|
| `waitUntilReady` block calling `logPersist.waitForAllProcessesReady()` | `waitForServiceReady` (runtime-state gate) |
| `logPersist.shutdownLogPersist()` | `shutdownLogSpool()` from SDK |
| `ensureLogPersistFromEnv` in `prepare()` | — main spool auto-enabled **after claim** by SDK |

### 3. Child processes (`guard.ts`, `scheduler.ts`, `worker.ts`, extras)

```typescript
import { enableLogSpoolFromEnvInChild } from "target-supabase-sdk/node";

await enableLogSpoolFromEnvInChild();
// replaces: await logPersist.registerProcess();
```

Spawn must set `LOG_PERSIST_PROCESS` (launcher / `ManagedChildProcesses` auto-inject when label matches role).

### 4. Extra roles (download-service `chrome-sidecar`)

Preload only — do **not** import SDK process-role helpers:

```javascript
runServicePreload({ logSpoolExtraProcessRoles: ["chrome-sidecar"] });
```

### 5. Observability / dashboards

| Old | New |
|-----|-----|
| `logPersist.ready` / `snapshotProcessesReady()` | **Delete** — no registry |
| `getPersistStats()` lane queues | `getLogSpoolStats()` → `bufferedEntries`, `bufferedBytes` |
| `LogPersistStats`, `LogPersistReadySnapshot` types | `LogSpoolWriterStats` |

### 6. Local runtime cleanup (one-time)

```text
rm -rf data/runtime/log-persist-registry/
```

Stale `main.json` shards cause `stale=main` on **old** builds only — safe to delete after migration.

### 7. Verify

```bash
cd ../supabase-sdk && pnpm build
cd ../<service> && pnpm install && pnpm verify
rg 'createLogPersistCoordinator|waitForAllProcessesReady|resolveLogPersistRegistryPath|ensureLogPersistFromEnv|shutdownLogPersist' src/
```

Must return **no matches** in `src/`.

---

## Per-repo status (audit template)

| Service | SDK lifecycle imports | `waitForAllProcessesReady` | Child `enableLogSpool` | Extra roles preload |
|---------|----------------------|----------------------------|------------------------|---------------------|
| log-service | ✅ | ✅ removed | ✅ | n/a |
| watch-service | ✅ | ✅ removed | ✅ | n/a |
| download-service | ✅ | ✅ removed | ✅ | ✅ chrome-sidecar |
| upload-service | ✅ | ✅ removed | ✅ | n/a |
| cv-service | ✅ | ✅ removed | ✅ | n/a |
| gc-service | ✅ | ✅ removed | ✅ | n/a |

Update this table when each repo lands.

---

## Common failure signatures

| Symptom | Cause |
|---------|--------|
| `waitForLogPersistReady timed out`, `stale=main` | Old coordinator + main never registers; stale `log-persist-registry/main.json` |
| `does not provide an export named 'createLogPersistCoordinator'` | SDK rebuilt, service `dist/` or `src/` not migrated |
| `SERVICE_SLOTS_FULL` + libuv assertion on Windows | Unrelated slot issue; rough `process.exit` — fix registry first |
| Guard logs OK, main fatal on persist | **Delete** `waitForAllProcessesReady` — not replace |

---

## Do not

- Reintroduce `waitForAllProcessesReady` with a fake always-ok shim in services
- Call `ensureLogSpoolFromEnv` in preload (needs `LOG_SPOOL_SERVICE_ID` after claim)
- Call `ensureLogSpoolFromEnv` in main `prepare()` before claim (SDK does it after claim)
- Keep `log-persist-registry/` for readiness — spool uses `log-spool/` + guard collect-log

## Related skills

- [log-spool](../log-spool/SKILL.md) — spool layout and env
- [l3-service-host](../l3-service-host/SKILL.md) — `createServiceHost` integration
- [service-preload](../service-preload/SKILL.md) — preload + extra process roles
