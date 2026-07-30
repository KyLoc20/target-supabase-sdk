---
name: json-state-store
description: >-
  JSON file-backed cross-process state for target-supabase-sdk/node:
  createJsonFileStateStore with nested key merge and atomic writes;
  createServiceRuntimeStateStore with per-slice sharding for L3 services.
  Use when implementing runtime state, diagnosing readiness/worker gate failures,
  or choosing shard vs monolithic JSON layout for multi-process Node services.
---

# JSON state store (target-supabase-sdk/node)

## Import

```typescript
import { createJsonFileStateStore, createServiceRuntimeStateStore } from "target-supabase-sdk/node";
```

Locations:
- `src/node/fs/json-state-store.ts` — single-file store
- `src/node/fs/sharded-json-state-store.ts` — one file per top-level slice
- `src/node/fs/runtime-state-path.ts` — `state.json` → `runtime-state/` resolution
- `src/node/runtime-state/create-service-runtime-state-store.ts` — L3 blueprint

---

## Incident: monolithic `state.json` wiped readiness/worker (SDK ≥0.2.5 fix)

### Symptoms

| Signal | Typical value |
|--------|---------------|
| Overview Runtime Health | `degraded` |
| `readiness.status` | `"pending"`, `checkedAt: null` |
| `worker.ready` | `false`, `pid: null` |
| TaskNode fleet | healthy (Supabase heartbeats OK) |
| `GET /health` | 503 |

Main process had passed readiness and worker was running, but persisted runtime state showed a fresh default — gate logic correctly reported not ready.

### Root cause chain

1. **Four writers, one file** — main, guard, scheduler, and worker all read-modify-write the same `state.json`.
2. **Atomic rename races (Windows)** — `createJsonFileStateStore` writes via `write(temp)` + `rename(temp, target)`. Concurrent writers on Windows often get `EPERM` on rename (same class of failure as log-persist registry — see [service-preload](../service-preload/SKILL.md)).
3. **Silent full reset (pre-0.2.5)** — `read()` caught **any** error and returned `defaultState`, so a transient read during a concurrent rename looked like “empty state” and the next `write()` persisted defaults over real slices.
4. **Cross-slice clobber** — guard/scheduler tick writes merged against wiped defaults → `readiness`, `worker`, `registry` lost even though those processes did not write that tick.

Linux Docker was less affected; **`pnpm start` on Windows** reproduced it reliably.

### Solution (SDK 0.2.5+): per-slice shards

Same pattern as **log-persist registry** — each writer owns one file:

```text
data/runtime/
  state.json                    ← legacy; migrated once then deleted
  runtime-state/
    readiness.json              ← main (readiness runner)
    guard.json                  ← guard process
    scheduler.json              ← scheduler tick (finishRunnerTick)
    worker.json                 ← worker process
    registry.json               ← main onRegistryClaimed + guard slot checks
    pipeline.json               ← log-service extra slice (extraDefaults)
```

| Approach | Verdict | Why |
|----------|---------|-----|
| Monolithic `state.json` + multi-process RMW | ❌ | Lost updates; readiness/worker/registry wiped |
| File lock in each service repo | ⚠️ | Works but duplicates fix; every L3 service must copy |
| **Per-slice shards in SDK** | ✅ | Guard tick only touches `guard.json`; no cross-slice clobber |
| Shared `_meta.json` for `updatedAt` | ❌ | Becomes a second hot file; concurrent rename on Windows |

**Fix belongs in SDK**, not per-service workarounds. Callers keep the same API; bump to `0.2.5+` only.

### Lessons learned

1. **One writer per file** for cross-process JSON — applies to runtime state and log-persist registry.
2. **Never swallow read errors** into full defaults on shared state — throws (or per-shard defaults on `ENOENT` only).
3. **Do not derive global metadata from a shared write path** — `updatedAt` is computed on read from latest shard mtime.
4. **Symptoms can mislead** — TaskNode healthy while runtime gate broken means local persisted state, not Supabase.
5. **Legacy migration** — `filePath: join(runtimeDataDir(), "state.json")` still valid; first read migrates to `runtime-state/` and removes old file.
6. **No caller code changes** — same `createServiceRuntimeStateStore`, `extraDefaults`, and method names.

---

## Single-file store

Use for **one writer** or custom shapes. Do **not** use one monolithic file for multi-process L3 runtime state (guard/scheduler/worker concurrent RMW).

```typescript
const store = createJsonFileStateStore({
  filePath: join(dataDir, "custom-state.json"),
  defaultState: DEFAULT_STATE,
  nestedKeys: ["readiness", "guard", "worker"],
  updatedAtKey: "updatedAt",
});

await store.read();
await store.write({ worker: { ready: true } });
await store.reset();
```

`read()` throws on parse/IO errors (except `ENOENT` → defaults). Avoids silently resetting full state on transient Windows rename races.

---

## L3 runtime state (sharded)

**`createServiceRuntimeStateStore`** persists each top-level slice in its own file under `runtime-state/`:

| `filePath` option | Shard directory | Legacy migration |
|-------------------|-----------------|------------------|
| `…/state.json` | `…/runtime-state/*.json` | reads + deletes `state.json` once |
| `…/runtime-state/` | same directory | none |

```typescript
const runtimeState = createServiceRuntimeStateStore({
  filePath: join(runtimeDataDir(), "state.json"),
  extraDefaults: { pipeline: DEFAULT_PIPELINE_SLICE }, // log-service → pipeline.json
});

export const { readRuntimeState, writeRuntimeState, resetRuntimeStateForStartup, finishRunnerTick } =
  runtimeState;
```

Each process writes only its slice — no cross-slice lost updates. Top-level `updatedAt` is derived on read from the latest shard file mtime (no shared meta file).

Pair with `ServiceReadyGate` + `waitForServiceReady` — see [readiness](../readiness/SKILL.md).

---

## Related skills

| Skill | Link |
|-------|------|
| Log-persist shard registry (same Windows EPERM class) | [service-preload](../service-preload/SKILL.md) |
| L3 host + slice ownership | [l3-service-host](../l3-service-host/SKILL.md) |
| Ready gate reads `readiness` + `worker` slices | [readiness](../readiness/SKILL.md) |
| `/health` aggregates runtime + TaskNode | [observability](../observability/SKILL.md) |
| Reference service wiring | [watch-service SKILL](../../watch-service/.cursor/skills/watch-service/SKILL.md) |

---

## Do not

- Put multi-process L3 runtime state in one JSON file
- Add per-service file-lock wrappers when SDK sharding exists — bump SDK instead
- Add a shared `_meta.json` (or any hot shared file) updated on every slice write
- Catch all `read()` errors and return full `defaultState` on shared cross-process files
- Read `state.json` directly from scripts — use `readRuntimeState()` or read `runtime-state/*.json`
