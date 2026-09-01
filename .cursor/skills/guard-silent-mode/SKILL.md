---
name: guard-silent-mode
description: >-
  ServiceGuardNode silent mode, spawn ownership (main→guard only; guard→scheduler+worker),
  and HTTP liveness vs readiness for L3 services on target-supabase-sdk. Use when
  implementing or reviewing ServiceGuardNode, spawnBusinessNodes, isGuardAvailable,
  guardRetryAfterSec, consecutive heartbeat failure, Docker healthcheck 503 loops,
  or migrating L3 main off spawnScheduler / criticalSupervisors scheduler.
---

# Guard silent mode and spawn ownership

## Spawn boundary

| Parent | Spawns |
|--------|--------|
| **main** | Guard only. download-service also spawns **chrome-sidecar** (not a Node) before Guard. |
| **Guard** | scheduler + worker (download scheduler is noop). |

`criticalSupervisors` is **`["guard"]` only**. Do not list `scheduler` — Guard death still takes down the host; scheduler death is recovered by Guard.

Main `stopAll` must pass `extraPids` for worker and scheduler (Guard spawned them in another OS process).

`stopBusinessNodes` runs **in the Guard process** and must not stop Guard or main. Reset `worker.ready` / `scheduler.ready` to `false` so recovery does not succeed on stale flags.

## Silent vs exit

Silent is **consecutive Guard heartbeat failure only** (threshold 3). Not worker crash, not a brief `ready=false` during respawn.

| Trigger | Behavior |
|---------|----------|
| Heartbeat consecutive failures | Enter silent: persist `guard.mode`, stop business nodes, heartbeat-only loop with backoff 15s→5min. **No `process.exit`.** |
| Heartbeat restored | Recover: stop → `spawnBusinessNodes` → wait `isBusinessReady`. Failure returns to silent. |
| Bootstrap readiness / register-node failure | Guard still exits → host dies (cannot start without DB). |
| SIGTERM / SIGINT / slot lost / uncaughtException | Still shutdown/exit. |

Healthy loop **ensures** business processes via idempotent `spawnBusinessNodes` (respawn exited children). TaskNode stale respawn stays on the guard runner. Do **not** enter silent when `isBusinessReady()` is false — that races worker restart.

## HTTP

Docker healthchecks treat non-2xx as restart. Silent must not flap the container.

| Surface | Silent / offline |
|---------|------------------|
| **`/health*`** | Local runtime only (`readiness.passed` + registry). **200** while main is up. JSON includes `available: isGuardAvailable(guard)`. |
| **`/observability`** | `ok` includes `isGuardAvailable`. Tolerate `scanTargetList` failure. **503** + `Retry-After` from `guardRetryAfterSec`. |
| **Business routes** | **503** + `Retry-After`. Static `/ui/` may stay up. |

```typescript
import { guardRetryAfterSec, isGuardAvailable } from "target-supabase-sdk/node";

isGuardAvailable(runtime.guard); // mode omitted or "healthy"
guardRetryAfterSec(runtime.guard); // null when available
```

## Wiring (blueprint)

```typescript
ServiceGuardNode.create({
  spawnBusinessNodes, // scheduler + worker (idempotent)
  stopBusinessNodes,
  isBusinessReady,    // worker.ready && scheduler.ready
  businessReadyTimeoutMs: startupReadyTimeoutMs(),
  guardRunner: { /* no spawnWorker */ },
});
```

Main: `startSupervisors: () => { spawnGuard(); }` (download: chrome-sidecar then Guard).

Use [createL3ChildLauncher](../process-spawn/SKILL.md) in `launcher.ts` for spawn/stop. Scheduler writes `scheduler.ready` in `onBeforeRegisterNode` (same pattern as TaskNode `worker.ready`). Bootstrap `waitForServiceReady` requires both (download also waits `chromeSidecar.ready`).

Blueprint: [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md).

## Related

- [service-guard](../service-guard/SKILL.md)
- [l3-service-host](../l3-service-host/SKILL.md)
- [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md)
