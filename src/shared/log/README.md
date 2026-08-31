# Log module (`src/shared/log`)

Structured logging, optional file-backed persistence, and Supabase `LogBatch` upload for L3 services.

## Layout

```text
src/shared/log/
  README.md
  index.ts                 # browser-safe public API (re-exports core + upload types)

  core/                    # in-process logging (browser + Node)
    log-manager.ts         # LogManager singleton, LogEntry, levels
    create-logger.ts       # createLogger({ module, scope, … })
    log-scope.ts           # traceId / labels / patchScope
    log-min-level.ts       # LOG_MIN_LEVEL env
    log-batch.ts           # decode persisted LogBatch Lists (read side)

  upload/                  # shared Supabase upload pipeline (Node)
    env.ts                 # LOG_PERSIST_ENABLED, SERVICE, PROCESS, runtime dir
    interface.ts           # LogBatch meta, loader keys, lane type
    batch-id.ts            # computeLogBatchIdempotencyKey
    flush.ts               # buildLogListDraft, postLogBatch
    hook.ts                # LogManager → spool writer offer bridge
    logger.ts              # internal pipeline loggers (no feedback loop)

  spool/                   # file-backed persistence (Node only)
    enable.ts              # ensureLogSpoolFromEnv, spawn env helpers
    service-lifecycle.ts   # isLogSpoolEnabled, enableLogSpoolFromEnvInChild, shutdownLogSpool
    writer.ts              # per-process memory buffer → .tmp files
    collector.ts           # guard: upload .tmp, rename .json, periodic GC
    paths.ts               # {RUNTIME_DATA_DIR}/log-spool/{serviceId}/…
    file.ts                # batch filename parse/build
    process-roles.ts       # main|guard|scheduler|worker + extras
    config.ts              # writer / GC / collect interval env
    coordinator.ts         # createLogSpoolCoordinator facade
    register-collect-log-runner.ts
```

**Package exports**

| Entry | Scope |
|-------|--------|
| `target-supabase-sdk` / `index.ts` | `core/` + decode types from `upload/interface` |
| `target-supabase-sdk/node` | spool + upload symbols used by L3 services |

Node-only code must not be imported from the browser bundle. Spool files use `node:fs`.

---

## Data flow

```text
App code
  → createLogger / logManager
  → offerToLogPersist (when spool enabled)
  → LogSpoolWriter (memory buffer)
  → {spoolRoot}/{serviceId}/{role}/*.tmp

Guard collect-log runner (1 min tick)
  → read *.tmp → postLogBatch → rename *.json
  → GC old tmp/json (once per day; 7 d retention)

log-service (downstream)
  → decodeLogBatch / LogTrace merge by traceId
```

**One-line rule:** producers flush `LogEntry[]` to `.tmp`; only the guard uploads `LogBatch` and renames to `.json`.

---

## Environment

| Key | Role |
|-----|------|
| `LOG_PERSIST_ENABLED` | Master switch (`true` → file spool) |
| `LOG_PERSIST_SERVICE` | Logical service value in List meta (e.g. `watch-service`) |
| `LOG_PERSIST_PROCESS` | This process role: `main` \| `guard` \| `scheduler` \| `worker` or extra |
| `LOG_SPOOL_SERVICE_ID` | Instance id — set by main after registry claim |
| `LOG_SPOOL_EXTRA_PROCESS_ROLES` | Comma-separated extras (e.g. `chrome-sidecar`) |
| `RUNTIME_DATA_DIR` | Runtime root; spool lives at `{dir}/log-spool/` |
| `LOG_SPOOL_DIR` | Optional override for spool root parent |

### Writer tuning

| Key | Default |
|-----|---------|
| `LOG_SPOOL_MAX_ENTRIES` | 2000 |
| `LOG_SPOOL_MAX_BYTES` | 2 MB |
| `LOG_SPOOL_FLUSH_DEBOUNCE_MS` | 3 s (after count/byte threshold) |
| `LOG_SPOOL_MAX_AGE_MS` | 60 s (flush buffered logs even when below threshold) |
| `LOG_PERSIST_POST_TIMEOUT_MS` | 30 s |

### Collector / GC

| Key | Default |
|-----|---------|
| `LOG_SPOOL_COLLECT_INTERVAL_MS` | 60 s |
| `LOG_SPOOL_GC_INTERVAL_MS` | 24 h (how often guard runs tmp/json GC) |
| `LOG_SPOOL_SYNCED_RETENTION_MS` | 7 d (delete `.json` when mtime older than this) |
| `LOG_SPOOL_TMP_RETENTION_MS` | 7 d (delete stale `.tmp` by filename timestamp) |

---

## On-disk layout

```text
{RUNTIME_DATA_DIR}/log-spool/{serviceId}/
  main/main.{YYYYMMDDHHmmss}.{hash8}.tmp   → .json after upload
  guard/…
  scheduler/…
  worker/…
  {extra}/…
```

Upload state: `.tmp` = pending, `.json` = uploaded (no central index file).

Batch file JSON: `{ entries: LogEntry[], meta?: { serviceId, processRole, serviceValue } }`.

Uploaded List meta:

- `meta.process` = `{serviceId}:{processRole}` (e.g. `abc123:worker`)
- `meta.service` = logical value (`watch-service`)
- `meta.lane` = `"slow"` (legacy transport field; required for decode today)

---

## L3 integration

### Preload (`runServicePreload`)

Sync phases set `LOG_PERSIST_SERVICE`, `RUNTIME_DATA_DIR`, validate env, merge `logSpoolExtraProcessRoles`.  
**Do not** call `ensureLogSpoolFromEnv` in preload — it is async and needs `LOG_SPOOL_SERVICE_ID`.

### Main (`createServiceHost`)

After registry claim, main sets `LOG_SPOOL_SERVICE_ID` and calls `ensureLogSpoolFromEnv({ processRole: "main", … })`.

### Child processes

Guard / scheduler / worker `main()`:

```typescript
import { enableLogSpoolFromEnvInChild } from "target-supabase-sdk/node";

await enableLogSpoolFromEnvInChild();
```

### Shutdown

```typescript
import { shutdownLogSpool } from "target-supabase-sdk/node";

await shutdownLogSpool();
```

Flushes remaining memory buffer to `.tmp`.

### Extra process roles (e.g. download-service `chrome-sidecar`)

```javascript
// scripts/preload.mjs
runServicePreload({
  // …
  logSpoolExtraProcessRoles: ["chrome-sidecar"],
});
```

---

## Public Node API (curated)

| Symbol | Role |
|--------|------|
| `ensureLogSpoolFromEnv` | Enable writer in current process |
| `enableLogSpoolFromEnvInChild` | Child entry: no-op when disabled, else `ensureLogSpoolFromEnv` |
| `isLogSpoolEnabled` | Read master switch (`LOG_PERSIST_ENABLED`) |
| `getMainLogSpoolWriterStats` | Writer stats or `null` when disabled (main observability) |
| `shutdownLogSpool` | No-op when disabled, else flush + disable |
| `shutdownLogSpoolFromEnv` | Flush buffer + disable (unconditional) |
| `getLogSpoolStats` | Writer buffer stats |
| `buildLogSpoolSpawnEnv` | Manual child env (usually unnecessary) |
| `validateLogSpoolPreloadEnv` | Preload validation |
| `logSpoolEnabledFromEnv` | Read master switch |
| `createLogSpoolCoordinator` | Service-bound lifecycle facade |
| `registerCollectLogRunner` | Guard TriggerNode runner (via `ServiceGuardNode`) |
| `runCollectLogTick` | Manual / tests |
| `resolveLogSpoolRoot` | Spool directory path |

Internal helpers (`resolveLogSpoolSpawnEnvForLabel`, `resolveAllLogSpoolProcessRoles`, etc.) are not exported from `node` — use preload `logSpoolExtraProcessRoles` or env instead.

---

## Concurrency (Windows)

- One writer per `.tmp` file — producers only create new files.
- Guard renames after successful upload; does not RMW batch contents.
- GC scans directories; no shared JSON index file.

---

## Related skills

- [log-spool](../../../.cursor/skills/log-spool/SKILL.md) — agent quick reference
- [service-preload](../../../.cursor/skills/service-preload/SKILL.md) — preload protocol
- [l3-service-host](../../../.cursor/skills/l3-service-host/SKILL.md) — `createServiceHost` integration
