---
name: service-guard
description: >-
  ServiceGuardNode for L3 services on target-supabase-sdk: readiness gate,
  spawnBusinessNodes (scheduler+worker), registry slot, TaskNode liveness,
  silent mode, isGuardAvailable / guardRetryAfterSec. Blueprint: watch-service.
  Use when wiring src/processes/service-guard.ts or reviewing guard ticks.
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

Silent mode, spawn ownership, and HTTP liveness vs readiness: [guard-silent-mode](../guard-silent-mode/SKILL.md).
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

- [guard-silent-mode](../guard-silent-mode/SKILL.md) — silent + spawn ownership
- [l3-service-host](../l3-service-host/SKILL.md)
- [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md) — blueprint service
