# ServiceGuardNode (target-supabase-sdk/node)

Reusable L3 **guard process** — readiness gate, TaskNode spawn owner, registry slot
check, TaskNode liveness, Service runtime heartbeat.

## Import

```typescript
import {
  ServiceGuardNode,
  registerServiceGuardRunner,
  runServiceGuardTick,
  runReadinessGate,
  SERVICE_GUARD_RUNNER_KEY,
  markWorkerSpawned,
} from "target-supabase-sdk/node";
```

Location: `src/node/service-guard/`

## Per-service wiring (blueprint)

```typescript
// src/processes/service-guard.ts
export function createServiceGuardNode(): ServiceGuardNode {
  return ServiceGuardNode.create({
    serviceValue: SERVICE_VALUE,
    logTopic: "guard",
    readinessChecks: guardReadinessChecks,
    onReadinessReport: persistReadinessReport,
    spawnWorker: spawnTaskWorker,
    onWorkerSpawned: markWorkerSpawned,
    guardRunner: {
      getServiceId: async () => (await readRuntimeState()).registry.serviceId,
      intervalMs: guardCheckIntervalMs(),
      initialDelayMs: guardStartupGraceMs(),
      taskNodeStaleMs: taskNodeStaleMs(),
      workerSpawnCooldownMs: workerSpawnCooldownMs(),
      spawnWorker: spawnTaskWorker,
      onRegistryPatch: (patch) => writeRuntimeState({ registry: patch }),
      onGuardPatch: (patch) => writeRuntimeState({ guard: patch }),
    },
  });
}
```

```typescript
// src/processes/guard.ts
await initSupabaseFromEnv();
await ensureLogSpoolFromEnv();
await createServiceGuardNode().start();
```

Reference implementations: **watch-service**, **log-service** (`src/processes/service-guard.ts`).

## Runtime state — `guard` slice (all L3 services)

| Field | Writer |
|-------|--------|
| `nodeId` | service-guard runner |
| `lastCheckAt` | service-guard runner |
| `lastDecision` | service-guard runner (`idle`, `slot_ok`, `healthy`, `spawn_worker`, …) |
| `lastSpawnAt` | launcher on worker spawn |
| `spawnCount` | launcher on worker spawn |

Do **not** use `supervisor` — unified name is `guard`.

## API layers

| Export | Role |
|--------|------|
| `runReadinessGate` | checks → callback → fail-fast |
| `runServiceGuardTick` | one runner tick (slot + liveness + heartbeat) |
| `registerServiceGuardRunner` | TriggerManager registration |
| `ServiceGuardNode.create` | readiness + spawn worker + registered runner |

Default runner key: `SERVICE_GUARD_RUNNER_KEY` (`"service-guard"`).

## Future plan — task reclaim on node LOST (SDK, not implemented)

Today guard **respawns** worker when TaskNode heartbeat is stale (`taskNodeStaleMs`) but
does **not** reclaim Tasks still **DOING** under the dead node's `nodeId`.

**Planned (SDK):** when a Node becomes `LOST` — via `patchStopNode` and/or stale-node
marking — `CANCEL` all `DOING` tasks owned by that `nodeId` back to **TODO**.
See [task-state-machine § Future plan](../task-state-machine/SKILL.md#future-plan--reclaim-doing-on-node-lost-not-implemented).

L3 consumer services must **not** add global DOING reclaim schedulers; wait for SDK.

## Related

- [l3-service-host](../l3-service-host/SKILL.md)
- [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md) — blueprint service
