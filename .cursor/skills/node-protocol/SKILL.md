---
name: node-protocol
description: >-
  Node Target protocol (category=node) in target-supabase-sdk 0.3.0+: NodeKind on
  value, service instance id on name, postRegisterNode payload, LOG_SPOOL_SERVICE_ID,
  Guard scoped scan vs fleet GC, nodesForTaskLiveness, Service.runtime.nodes rollup.
  Use when registering TaskNode/TriggerNode/ServiceGuardNode, reviewing guard ticks,
  gc-service overview vs observability, or ops cleanup of legacy empty name/value rows.
---

# Node protocol (`category = node`)

SDK **0.3.0+** — **not backward compatible** with rows where `name` and `value` were empty.

---

## Target row shape

| Field | Meaning |
|-------|---------|
| `category` | `"node"` (`CategoryNode.NODE`) |
| `name` | **Owning Service instance id** (`postService` row id / registry `serviceId`). Empty only for nodes intentionally outside a service (production L3 should always set). |
| `value` | **Role** — {@link NodeKind} string |
| `details.status` | `READY` → `BUSY` → `LOST` (unchanged) |
| `details.lastHeartBeat` | ms epoch (unchanged) |
| `details.manifestVersion` | `0` at create (unchanged) |

### `NodeKind` (`Node.value`)

| Enum | Process / class |
|------|-----------------|
| `node.task` | `TaskNode` (worker) |
| `node.trigger` | `TriggerNode` (scheduler) |
| `node.guard` | `ServiceGuardNode` |
| `node.other` | Generic `BaseNodeRuntime` / reserved |

---

## Registration API

`postRegisterNode` (browser entry — Zod validated):

```typescript
postRegisterNode({ serviceId, kind: NodeKind.TASK, traceId? });
```

Creates row: `name = serviceId`, `value = kind`, `details.status = READY`.

Runtime processes do **not** call this directly — {@link BaseNodeRuntime} in `src/node/base-node-runtime.ts` calls it after {@link requireNodeServiceIdFromEnv}.

---

## Service instance id env

**Same variable as log spool:** `LOG_SPOOL_SERVICE_ID` (`LOG_SPOOL_SERVICE_ID_ENV`).

| Writer | When |
|--------|------|
| `createServiceHost` | Immediately after registry claim (always, even if log spool disabled) |
| `runSingleProcessService` | After claim, before `run()` |
| Child spawn | `ManagedChildProcesses.spawn` merges parent env + `resolveLogSpoolSpawnEnvForLabel` when parent already has `LOG_SPOOL_SERVICE_ID` |

Missing env at node bootstrap → **fail-fast** (`requireNodeServiceIdFromEnv`) → shutdown; no anonymous legacy rows.

---

## Guard vs fleet (do not merge semantics)

| Concern | Scope | Implementation |
|---------|--------|----------------|
| **Worker liveness / respawn** | This Service instance only | `runServiceGuardTick`: `scanTargetList` with `name eq serviceId`; {@link evaluateBusyNodeLiveness} on {@link nodesForTaskLiveness} (`value === node.task`) |
| **Service.runtime.nodes** | Same instance | Rollup of scoped scan (all kinds: task + trigger + guard) |
| **Fleet GC (gc-service)** | Full project | `prepare-gc-node-payload`: scan all `BUSY` / `LOST` by `details->>status` — unchanged |
| **Overview dashboard (gc-service)** | Full fleet (A) | `overview.ts`: full `category=node` scan for `nodeFleet` stats |
| **gc observability / ok** | This gc instance | Fleet scan then filter `node.name === registry.serviceId` + `nodesForTaskLiveness` for health |

`ServiceNodeSnapshot` stays `{ nodeId, status, lastHeartBeat }` — **no `kind` field**.

---

## DB query usage (details)

| Use | `details` in WHERE? |
|-----|---------------------|
| Guard scoped list | No — `category` + **`name`** |
| gc-node stale scan | Yes — **`details->>status`** only |
| `patchChangeNodeStatus` optimistic lock | Yes — **`details->>status`** |
| Heartbeat age / liveness | No — in-memory after fetch |

Never filter Node rows by `details->>lastHeartBeat` in SQL today.

---

## Ops cutover (no online migration in SDK)

1. Upgrade **all** L3 services to SDK **0.3.0+** and redeploy (no old binaries writing empty `name`/`value`).
2. After stable run, delete legacy rows: `category = node` and empty `name` and empty `value`.
3. Optional: trim stale `Service.details.runtime` on old instance rows (Guard rewrites on tick).

---

## Related

- [service-guard](../service-guard/SKILL.md) — tick decisions, silent mode
- [l3-service-host](../l3-service-host/SKILL.md) — claim, spawn env, readiness
- [target-system-registry](../target-system-registry/SKILL.md) — Service runtime plane
- [task-state-machine](../task-state-machine/SKILL.md) — `nodeId` on Task rows (unchanged)
