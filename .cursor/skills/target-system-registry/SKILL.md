---
name: target-system-registry
description: >-
  Declarative system service registry in target-supabase-sdk: Config category,
  globally unique target-system-registry row, ServiceSlot capacity, registerService
  / unregisterService slot claims, getTargetSystemRegistry, postSystemRegistryConfig
  seed, and separation from Service guard runtime / monitor crash recovery. Use when
  implementing or reviewing service startup registration, graceful shutdown release,
  registry Config rows, ServiceSlot EMPTY/ACTIVE, or capacity limits for L3 services.
---

# Target system registry (Config + ServiceSlot)

## One-line rule

**Each L3 startup `postService`s a new instance row (same `value` allowed). `target-system-registry` Config lists `ServiceSlot`s; only instances that claim `EMPTY → ACTIVE` are available. Graceful shutdown releases the slot; a future monitor clears stale slots after crashes.**

Not the same as local `config/*.config.js` — see [config-file-relative-paths](../config-file-relative-paths/SKILL.md) for filesystem config.

---

## Data planes (do not merge)

```text
Control / capacity (Config)          Runtime (Service row)           Process detail (Node)
───────────────────────────          ─────────────────────           ─────────────────────
target-system-registry               category=service instance       category=node
details.objects: ServiceSlot[]       details.runtime (guard)         details.lastHeartBeat
EMPTY ↔ ACTIVE slot claims           heartbeat + node rollup         per-process liveness
```

| Plane | Authority | Writers |
|-------|-----------|---------|
| **Config `ServiceSlot`** | Declared replica count + which **instance id** owns which slot | Seed / ops (layout); `registerService` (`EMPTY→ACTIVE`); `unregisterService` (graceful `ACTIVE→EMPTY`); monitor (later, crash recovery) |
| **Service `details.runtime`** | Observed health of one instance + its nodes | Service **guard** only |
| **Service row** (`postService`) | One row per process startup; `value` = logical key (not unique) | L3 startup — **always new instance** via `claimServiceRegistrySlot` |
| **Availability** | Which instance is live | **`getTargetSystemRegistry`** / `resolveActiveRegistryServiceId` — not `getService({ value })` |

---

## Config row contract

Globally **unique**: `category=config` + `value=target-system-registry`.

| Field | Value |
|-------|--------|
| `name` | `target-system-registry` |
| `value` | `target-system-registry` (`TARGET_SYSTEM_REGISTRY_KEY`) |
| `category` | `CategoryConfig.CONFIG` |
| `details.manifestVersion` | `0` |
| `details.loaderKey` | `target-system-registry` (same as `value`) |
| `details.meta` | `{ revision: number }` — optimistic-lock token for slot writes |
| `details.objects` | `ServiceSlot[]` (flat array) |

Constant: `TARGET_SYSTEM_REGISTRY_KEY` in `src/service/config.interface.ts`.

**Replica count** = number of `ServiceSlot` rows with the same `serviceValue` (not a separate `maxInstances` field).

Example (two `watch-service` slots):

```json
"objects": [
  { "serviceValue": "log-service", "serviceId": null, "status": "EMPTY" },
  { "serviceValue": "watch-service", "serviceId": null, "status": "EMPTY" },
  { "serviceValue": "watch-service", "serviceId": null, "status": "EMPTY" }
]
```

---

## ServiceSlot (`service.interface.ts`)

```typescript
interface ServiceSlot {
  serviceValue: string;       // matches Service.value (e.g. "log-service")
  serviceId: string | null;   // bound Service.id when ACTIVE; null when EMPTY
  status: "EMPTY" | "ACTIVE"; // ServiceSlotStatus
}
```

- **Goal when healthy**: every slot should be `ACTIVE` (monitor + ops concern).
- **`serviceId`**: id of the **registered runtime** `Service` instance row (`postService` this startup).
- **`serviceValue`**: logical key (e.g. `watch-service`); many Service rows may share it; only the row bound in an ACTIVE slot is **available**.

---

## SDK layout ([manager-api-service](../manager-api-service/SKILL.md))

| File | Layer | Exports |
|------|-------|---------|
| `config.interface.ts` | types | `Config`, `ConfigDetails`, `CategoryConfig`, `TARGET_SYSTEM_REGISTRY_KEY` |
| `service.interface.ts` | types | `ServiceSlot`, `ServiceSlotStatus`, `ServiceDetails.runtime` |
| `config.api.ts` | API | `getConfig`, `postSystemRegistryConfig`, `buildEmptyServiceSlots`, `buildSystemRegistryConfigDetails` |
| `registry.service.ts` | Service | `getTargetSystemRegistry`, `claimServiceRegistrySlot`, `assertRegistrySlotAvailable`, `assertRegistrySlotOwner`, `registerService`, `unregisterService`, `patchServiceRuntime`, `parseServiceSlot(s)` |
| `registry-lifecycle.ts` | Service | `claimServiceRegistrySlot`, `runRegistrySlotGuardCheck`, `RegistrySlotRuntimeState`, `createClaimedRegistrySlotRuntimeState` |
| `node/service-host/` | Node | `createServiceHost`, `runSingleProcessService`, `applyRegistrySlotGuardStep` |

**Ops CLI / Web UI** live in **gc-service** — see `gc-service/.cursor/skills/system-registry-ops/SKILL.md` (`/ui/registry`, `pnpm seed:system-registry`, `pnpm reset:system-registry`).

Public entry: `target-supabase-sdk` (`browser.ts`).

---

## API: seed & read Config

### `postSystemRegistryConfig`

- Inserts the registry row once.
- **Duplicate guard**: `checkRedundancyFilterList` on `category=config` + `value=target-system-registry` ([create-target-redundancy](../create-target-redundancy/SKILL.md)).
- Default slots: `log-service`, `watch-service`, `download-service`, `storage-service`, `gc-service` (one EMPTY each).
- Override via payload `slots: [{ serviceValue }]`.

### `getConfig({ value })`

Generic Config read; registry uses `value: TARGET_SYSTEM_REGISTRY_KEY`.

### Ops tooling (gc-service, not this repo)

Seed / add / release / reset scripts and Web UI are maintained in **gc-service**:

```bash
# gc-service repo
pnpm seed:system-registry
pnpm seed:system-registry -- --add gc-service
pnpm seed:system-registry -- --release watch-service
pnpm reset:system-registry -- --yes
```

Web: `http://<gc-service-host>:3400/ui/registry`

Programmatic seed from any consumer:

1. `getConfig` — if exists, skip insert  
2. else `postSystemRegistryConfig`  
3. catch `isCreateTargetAlreadyExistsError` on race

---

## Service: `registerService`

**Only** `EMPTY → ACTIVE`. Does **not** write heartbeats or release slots.

Flow:

1. Load registry Config  
2. Reject if `service.value` not declared in any slot → `SERVICE_NOT_DECLARED`  
3. Find first `EMPTY` slot with matching `serviceValue` → else `SERVICE_SLOTS_FULL` (e.g. prior instance crashed without release)  
4. Set `serviceId = service.id`, `status = ACTIVE`  
5. `updateTargetDetails` with `optimisticLockFilterList: details->meta->>revision` ([optimistic-lock-update](../optimistic-lock-update/SKILL.md))

No idempotent skip — each startup must use a **new** `postService` row and a free slot.

`parseRegistryRevision` is **module-private** in `registry.service.ts`; do not export meta shape from `config.interface.ts`.

Input:

```typescript
registerService({ service, traceId?, maxAttempts? })
```

`service` = runtime `Service` instance from **`postService` this startup**, then passed to `registerServiceAtStartup`.

---

## Service: `unregisterService`

**Only** `ACTIVE → EMPTY` for the slot owned by `service.id`. Does **not** mutate the Service row.

Flow:

1. Load registry Config  
2. **Idempotent**: if no ACTIVE slot bound to `service.id` → return  
3. Clear `serviceId`, set `status = EMPTY`  
4. Same `meta.revision` optimistic lock as `registerService`

```typescript
unregisterService({ service, traceId?, maxAttempts? })
unregisterServiceAtShutdown({ service })  // best-effort; never throws — use in process shutdown
```

### Call sites (L3 services)

| Pattern | Where | Call |
|---------|-------|------|
| Multi-process main (watch / storage / download) | `main` SIGINT/SIGTERM after `stopChildProcesses` | `unregisterServiceAtShutdown({ service })` |
| Single-process TriggerNode (log-service) | `TriggerNode({ beforeProcessExit })` | hook → `unregisterServiceAtShutdown` |
| Startup failure after claim | `main().catch` when register succeeded | `unregisterServiceAtShutdown` |

Shutdown order (multi-process): `server.close` → stop children → **unregister** → log-persist shutdown → `process.exit`.

---

## Service: `getTargetSystemRegistry`

Read-only:

1. Load Config  
2. `parseServiceSlots(config)`  
3. For each slot with `serviceId`, `getService({ id })`  
4. Return `{ config, slots: [{ slot, service | null }] }`

Use for dashboards / monitor service input — not for slot mutation.

---

## Service runtime (`ServiceDetails.runtime`)

Guard-maintained; **not** written by registry:

```typescript
runtime?: {
  lastHeartBeat: number;
  nodes: { nodeId: string; status: NodeStatus; lastHeartBeat: number }[];
}
```

Zod: `serviceRuntimeSchema` in `service.api.ts`. Catalog `postService` may omit `runtime` until guard starts.

---

## Monitor service (future — not in SDK yet)

Owned by separate L3 service — **crash / ungraceful exit recovery only**:

- Read `getTargetSystemRegistry()` + check `Service.details.runtime` staleness  
- Write Config: `ACTIVE → EMPTY`, clear `serviceId`  
- Uses same `meta.revision` optimistic lock as `registerService` / `unregisterService`

Graceful exits must call `unregisterService` / `unregisterServiceAtShutdown` themselves.  
Do **not** implement stale detection inside `registerService`.

---

## Startup capacity gate (L3)

Use **`claimServiceRegistrySlot`**, **`createServiceHost`**, or **`runSingleProcessService`**. See [l3-service-host](../l3-service-host/SKILL.md).

After `postService`, **`registerServiceAtStartup`** claims the slot. On failure, delete the orphan Service row (`deleteTarget`) — do not leave unregistered instances.

Runtime: guard loop calls **`assertRegistrySlotOwner({ serviceValue, serviceId })`** — checks whether `serviceId` owns **any** ACTIVE slot (N>1 safe). Transient read failures → warn and skip tick; confirmed loss → shutdown. Main registers signal handlers **before** spawn; guard unexpected exit → main shutdown.

Removed: idempotent “already bound, skip register” — each startup must claim a fresh EMPTY slot or fail.

---

## Checklist (new L3 service)

- [ ] Add `{ serviceValue: "<name>" }` to seed slots (or ops updates Config `objects`) — e.g. `upload-service` in `DEFAULT_SYSTEM_REGISTRY_SEED_SLOTS` + `gc-service` `system-registry.seed.json`; on live Config use `appendSystemRegistrySlots` instead of full reset  
- [ ] Use **`createServiceHost`** or **`runSingleProcessService`**  
- [ ] `bootstrap.ts`: **`postService` new instance** every startup  
- [ ] **`ManagedChildProcesses`** + **`criticalSupervisors`**  
- [ ] **`applyRegistrySlotGuardStep`** each supervisor tick  
- [ ] **`RegistrySlotRuntimeState`** in runtime state + observability  
- [ ] Graceful shutdown → **`session.release()`**  
- [ ] `patchServiceRuntime({ serviceId, ... })`  
- [ ] Do not duplicate capacity in env vars — registry Config is source of truth  
- [ ] Do not store heartbeat in Config `meta` — only `revision`

---

## Anti-patterns

| Avoid | Why |
|-------|-----|
| Nested `maxInstances` + `instances[]` on Config | Use flat `ServiceSlot` rows (declarative replica count) |
| Exporting `SystemRegistryMeta` / rich meta types | Keep `ConfigDetails.meta` as `unknown`; revision parse stays private |
| Putting release inside `registerService` | Use `unregisterService` for graceful release |
| Relying only on monitor for Ctrl+C | Graceful path must self-release; monitor is crash recovery |
| Heartbeat in registry Config | Belongs on `Service.details.runtime` |
| Reusing a prior `Service` row on restart | Each startup = new instance + registry claim |
| Using `getService({ value })` for instance identity | Ambiguous with multiple rows; use `service.id` or registry |
| Second registry Config row | Enforce global uniqueness on `value` |

---

## Related skills

- [manager-api-service](../manager-api-service/SKILL.md) — `config.api` vs `registry.service`  
- [create-target-redundancy](../create-target-redundancy/SKILL.md) — `postSystemRegistryConfig` dedupe  
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — slot claim updates  
- [config-file-relative-paths](../config-file-relative-paths/SKILL.md) — local JS config (different concern)  
- [service-preload](../service-preload/SKILL.md) — L3 env bootstrap (orthogonal to DB registry)

## Key files

- `src/service/config.interface.ts` — `Config`, `TARGET_SYSTEM_REGISTRY_KEY`  
- `src/service/config.api.ts` — `getConfig`, `postSystemRegistryConfig`  
- `src/service/registry.service.ts` — `getTargetSystemRegistry`, `registerService`, `unregisterService`  
- `src/service/service.interface.ts` — `ServiceSlot`, `ServiceRuntime`  
- `src/node/node-runtime.base.ts` — `beforeProcessExit` hook for single-process L3  
- **gc-service** `scripts/system-registry.seed.json` — default slot layout for ops  
- **gc-service** `.cursor/skills/system-registry-ops/SKILL.md` — CLI + Web UI
