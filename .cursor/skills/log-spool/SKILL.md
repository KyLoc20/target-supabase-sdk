---
name: log-spool
description: >-
  File-backed log spool for target-supabase-sdk: per-process memory buffer,
  tmp flush, guard collect-log runner uploads LogBatch, suffix-based GC.
  Use when implementing or reviewing LOG_PERSIST_ENABLED, log-spool paths,
  buildLogSpoolSpawnEnv, or L3 log persistence.
---

# Log file spool (target-supabase-sdk)

Full module docs: [`src/shared/log/README.md`](../../src/shared/log/README.md).

## One-line rule

**Producers flush `LogEntry[]` to `.tmp` files; only the guard process uploads `LogBatch` and renames to `.json`.**

`LOG_PERSIST_ENABLED=true` enables **file spool** (not per-process Supabase flush).

---

## Source layout

```text
src/shared/log/
  core/       # LogManager, createLogger, decodeLogBatch (browser + Node)
  upload/     # buildLogListDraft, postLogBatch, idempotency hash
  spool/      # writer, collector, enable, coordinator
```

---

## Layout

```text
{RUNTIME_DATA_DIR}/log-spool/{serviceId}/
  main/main.{YYYYMMDDHHmmss}.{hash8}.tmp   → .json after upload
  guard/…
  scheduler/…
  worker/…
  {extra}/…              ← optional service-specific roles (e.g. chrome-sidecar)
```

| File | Writer | Reader |
|------|--------|--------|
| `*.tmp` | owning process (atomic `.part` → rename) | guard collect-log |
| `*.json` | guard (rename after upload) | ops / daily GC |

Upload state: `.tmp` = pending, `.json` = done (no `sync-state.json`).

On-disk batch shape: `{ entries: LogEntry[], meta?: { serviceId, processRole, serviceValue } }`.

List `meta.process` = `{serviceId}:{processRole}` (e.g. `abc:worker`).  
List `meta.service` = logical value (`watch-service`).  
`meta.lane` = fixed `"slow"` — legacy field; required for downstream decode today.

---

## Env

| Key | Role |
|-----|------|
| `LOG_PERSIST_ENABLED` | Master switch (name kept for compat) |
| `LOG_PERSIST_SERVICE` | Logical service value in List meta |
| `LOG_PERSIST_PROCESS` | Core `main` \| `guard` \| `scheduler` \| `worker`, or extra from `LOG_SPOOL_EXTRA_PROCESS_ROLES` |
| `LOG_SPOOL_EXTRA_PROCESS_ROLES` | Comma-separated extra roles (e.g. `chrome-sidecar`) — collector scans core + extras |
| `LOG_SPOOL_SERVICE_ID` | Instance id — set by main after registry claim |
| `RUNTIME_DATA_DIR` or `LOG_SPOOL_DIR` | Spool root parent |

Writer: `LOG_SPOOL_MAX_ENTRIES` (2000), `LOG_SPOOL_MAX_BYTES` (2MB), `LOG_SPOOL_FLUSH_DEBOUNCE_MS` (3s), **`LOG_SPOOL_MAX_AGE_MS` (60s)** — flush low-volume buffers by age.

Collector: `LOG_SPOOL_COLLECT_INTERVAL_MS` (60s). GC: `LOG_SPOOL_GC_INTERVAL_MS` (24h), retention `LOG_SPOOL_SYNCED_RETENTION_MS` / `LOG_SPOOL_TMP_RETENTION_MS` (7d).

---

## Startup sequence (serviceId propagation)

```text
preload                  → validate env, defaults (no serviceId)
main claim slot          → session.service.id
main enableLogSpool      → LOG_SPOOL_SERVICE_ID=session.service.id, process=main
spawn guard/scheduler    → ManagedChildProcesses.spawn auto-injects spool env
guard spawn worker       → same serviceId in env
guard ServiceGuardNode   → registerCollectLogRunner (1min)
```

`createServiceHost` enables main spool automatically when `LOG_PERSIST_ENABLED` (after claim).

Child spawn:

```typescript
childProcesses.spawn("guard", "dist/processes/guard.js");
// auto: LOG_SPOOL_SERVICE_ID + LOG_PERSIST_PROCESS=guard when parent env is set
```

---

## collect-log runner (guard only)

Registered in `ServiceGuardNode.create` when persistence enabled.

Per collect tick (upload):

1. Scan core + `LOG_SPOOL_EXTRA_PROCESS_ROLES` directories for `*.tmp`
2. Skip when matching `.json` already exists (remove orphan tmp)
3. Validate JSON + `isLogEntry` — invalid tmp deleted
4. `postLogBatch` (reuse `buildLogListDraft` + idempotency hash)
5. Rename `tmp` → `json`

Once per day (`LOG_SPOOL_GC_INTERVAL_MS`, default 24h):

6. GC stale `.tmp` (filename timestamp older than 7d)
7. GC synced `.json` (file mtime older than 7d)

Shutdown: parallel `stopAll` is OK — leftover `.tmp` is picked up on next guard tick or manual recovery.

---

## Concurrency (Windows)

- **One writer per file** — producer only creates new tmp; guard renames after upload.
- Do not RMW batch file contents from guard.

## Related skills

- [l3-log-spool-migration](../l3-log-spool-migration/SKILL.md) — **downstream L3 repo** migration checklist (required after SDK API removal)
- [json-state-store](../json-state-store/SKILL.md) incident lessons.

---

## SDK exports (`target-supabase-sdk/node`)

| Symbol | Role |
|--------|------|
| `isLogSpoolEnabled` | Read master switch |
| `enableLogSpoolFromEnvInChild` | Child entry: no-op when disabled, else `ensureLogSpoolFromEnv` |
| `getMainLogSpoolWriterStats` | Writer stats or `null` (main observability) |
| `shutdownLogSpool` | No-op when disabled, else flush + disable |
| `ensureLogSpoolFromEnv` | Producer enable (low-level) |
| `shutdownLogSpoolFromEnv` | Flush buffer + disable (unconditional) |
| `getLogSpoolStats` | Writer buffer stats |
| `buildLogSpoolSpawnEnv` | Child `LOG_SPOOL_SERVICE_ID` + `LOG_PERSIST_PROCESS` (optional — spawn auto-injects) |
| `createLogSpoolCoordinator` | L3 lifecycle facade |
| `registerCollectLogRunner` | Guard-only (also auto via `ServiceGuardNode`) |
| `runCollectLogTick` | Manual / tests |
| `validateLogSpoolPreloadEnv` | Preload validation |

Process-role helpers and `resolveLogSpoolSpawnEnvForLabel` are **internal** — configure extras via preload `logSpoolExtraProcessRoles` or `LOG_SPOOL_EXTRA_PROCESS_ROLES` env.

---

## L3 services (watch / download / storage)

| Action | Required? |
|--------|-----------|
| `childProcesses.spawn("guard\|scheduler\|worker\|extra", …)` with label = known role | ✅ spool env auto-injected |
| `enableLogSpoolFromEnvInChild()` in **guard / scheduler / worker** `main()` | ✅ reads env from spawn |
| `ensureLogSpoolFromEnv()` in **main `prepare()`** before claim | ❌ `createServiceHost` enables main spool after claim |
| `onShutdown` → `shutdownLogSpool` | ✅ flushes main memory buffer |

**Extra process roles** (e.g. download-service `chrome-sidecar`):

```typescript
// scripts/preload.mjs → runServicePreload({ …, logSpoolExtraProcessRoles: ["chrome-sidecar"] })
// or .env: LOG_SPOOL_EXTRA_PROCESS_ROLES=chrome-sidecar
```

`startSupervisors` receives `{ service, session, serviceId }` — use `ctx.serviceId` when needed.

## Downstream (log-service)

| Component | Change needed? |
|-----------|----------------|
| `decodeLogBatch` / `LogTrace` merge by `traceId` | **No** — still `LogBatch.0` + `details.items` |
| `meta.process` | Now `{serviceId}:worker` string — decode accepts any non-empty string |
| `meta.service` | Still logical value (`watch-service`) |
| `meta.lane` | Still `slow` |
| Filters on `process === "worker"` | **Review** — switch to `endsWith(":worker")` or filter by `service` + `traceId` only |

No log-service code changes required for the happy path.
