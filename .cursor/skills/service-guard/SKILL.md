---
name: service-guard
description: >-
  ServiceGuardNode for L3 services on target-supabase-sdk: readiness gate,
  spawnBusinessNodes (scheduler+worker), registry slot, TaskNode liveness,
  silent mode, spawn ownership (main→guard only; guard→scheduler+worker),
  isGuardAvailable / guardRetryAfterSec, consecutive heartbeat failure,
  Docker healthcheck 503 loops, HTTP /health vs /observability.
  Blueprint: watch-service. Use when wiring src/processes/service-guard.ts
  or reviewing guard ticks, silent mode, or migrating L3 main off
  spawnScheduler / criticalSupervisors scheduler.
---

# ServiceGuardNode (target-supabase-sdk/node)

Reusable L3 **guard process** — readiness gate, business-node spawn owner, registry slot
check, TaskNode liveness, Service runtime heartbeat, silent mode on network loss.

## Import

```typescript
import {
  ServiceGuardNode,
  registerServiceGuardRunner,
  runServiceGuardTick,
  runReadinessGate,
  isGuardAvailable,
  guardRetryAfterSec,
  SERVICE_GUARD_RUNNER_KEY,
} from "target-supabase-sdk/node";
```

Location: `src/node/service-guard/` (`runReadinessGate` lives in `src/node/readiness/`).

`ServiceGuardNode.create` registers the guard + collect-log runners, then on bootstrap runs the readiness gate and **`spawnBusinessNodes`**. Worker spawn cooldown is recorded automatically — do not pass `spawnWorker` inside `guardRunner`.

```typescript
import { createL3ChildLauncher } from "target-supabase-sdk/node";
```

`spawnBusinessNodes` / `stopBusinessNodes` / `isBusinessReady` come from `createL3ChildLauncher` — do not hand-roll in the service.

Blueprint: [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md).

## Per-service wiring (blueprint)

```typescript
// src/processes/service-guard.ts
export function createServiceGuardNode(): ServiceGuardNode {
  return ServiceGuardNode.create({
    serviceValue: SERVICE_VALUE,
    logTopic: "guard",
    readinessChecks: guardReadinessChecks,
    onReadinessReport: persistReadinessReport,
    spawnBusinessNodes,
    stopBusinessNodes,
    isBusinessReady,
    businessReadyTimeoutMs: startupReadyTimeoutMs(),
    guardRunner: {
      getServiceId: async () => (await readRuntimeState()).registry.serviceId,
      intervalMs: guardCheckIntervalMs(),
      initialDelayMs: guardStartupGraceMs(),
      taskNodeStaleMs: taskNodeStaleMs(),
      workerSpawnCooldownMs: workerSpawnCooldownMs(),
      onRegistryPatch: (patch) => writeRuntimeState({ registry: patch }),
      onGuardPatch: (patch) => writeRuntimeState({ guard: patch }),
    },
  });
}
```

```typescript
// src/processes/guard.ts
await initSupabaseFromEnv();
await enableLogSpoolFromEnvInChild();
await createServiceGuardNode().start();
```

Reference implementations: **watch-service**, **log-service** (`src/processes/service-guard.ts`).

## Spawn ownership

| Parent | Spawns |
|--------|--------|
| **main** | Guard only. download-service also spawns **chrome-sidecar** (not a Node) before Guard. |
| **Guard** | scheduler + worker (download scheduler is noop). |

`criticalSupervisors` is **`["guard"]` only**. Do not list `scheduler` — Guard death still takes down the host; scheduler death is recovered by Guard.

Main `stopAll` must pass `extraPids` for worker and scheduler (Guard spawned them in another OS process).

`stopBusinessNodes` runs **in the Guard process** and must not stop Guard or main. Reset `worker.ready` / `scheduler.ready` to `false` so recovery does not succeed on stale flags.

Use `createL3ChildLauncher` in `launcher.ts` for spawn/stop. Scheduler writes `scheduler.ready` in `onBeforeRegisterNode` (same pattern as TaskNode `worker.ready`). Bootstrap `waitForServiceReady` requires both (download also waits `chromeSidecar.ready`).

## Silent vs exit

Silent is **consecutive Guard heartbeat failure only** (threshold 3). Not worker crash, not a brief `ready=false` during respawn.

| Trigger | Behavior |
|---------|----------|
| Heartbeat consecutive failures | Enter silent: persist `guard.mode`, stop business nodes, heartbeat-only loop with backoff 15s→5min. **No `process.exit`.** |
| Heartbeat restored | Recover: stop → `spawnBusinessNodes` → wait `isBusinessReady`. Failure returns to silent. |
| Bootstrap readiness / register-node failure | Guard still exits → host dies (cannot start without DB). |
| SIGTERM / SIGINT / slot lost / uncaughtException | Still shutdown/exit. |

Healthy loop **ensures** business processes via idempotent `spawnBusinessNodes` (respawn exited children). TaskNode stale respawn stays on the guard runner. Do **not** enter silent when `isBusinessReady()` is false — that races worker restart.

## HTTP (liveness vs readiness)

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

## Runtime state — `guard` slice (all L3 services)

| Field | Writer |
|-------|--------|
| `nodeId` | service-guard runner |
| `lastCheckAt` | service-guard runner |
| `lastDecision` | service-guard runner (`idle`, `slot_ok`, `healthy`, `spawn_worker`, `silent:…`, `recover_ok`, …) |
| `lastSpawnAt` | launcher on worker spawn |
| `spawnCount` | launcher on worker spawn |
| `mode` | Guard (`healthy` / `silent` / `recovering`) |
| `silent*` | Guard while unavailable (backoff, events) |

Scheduler slice also has `pid` / `ready` / `readyAt` (worker-shaped). Do **not** use `supervisor` — unified name is `guard`.

## API layers

| Export | Role |
|--------|------|
| `runReadinessGate` | checks → callback → fail-fast |
| `runServiceGuardTick` | one runner tick (slot + liveness + heartbeat) |
| `registerServiceGuardRunner` | TriggerManager registration |
| `ServiceGuardNode.create` | readiness + spawn business nodes + registered runner |
| `isGuardAvailable` / `guardRetryAfterSec` | HTTP availability |

Default runner key: `SERVICE_GUARD_RUNNER_KEY` (`"service-guard"`).

## Future plan — task reclaim on node LOST (SDK, not implemented)

Today guard **respawns** worker when TaskNode heartbeat is stale (`taskNodeStaleMs`) but
does **not** reclaim Tasks still **DOING** under the dead node's `nodeId`.

**Planned (SDK):** when a Node becomes `LOST` — via `patchStopNode` and/or stale-node
marking — `CANCEL` all `DOING` tasks owned by that `nodeId` back to **TODO**.
See [task-state-machine § Future plan](../task-state-machine/SKILL.md#future-plan--reclaim-doing-on-node-lost-not-implemented).

L3 consumer services must **not** add global DOING reclaim schedulers; wait for SDK.

## Related

- [l3-service-host](../l3-service-host/SKILL.md) — host, spawn, readiness, extraPids
- [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md) — blueprint service
