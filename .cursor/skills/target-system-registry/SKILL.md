---
name: target-system-registry
description: >-
  Declarative system service registry in target-supabase-sdk: Config category,
  globally unique target-system-registry row, ServiceSlot capacity, registerService
  slot claims, getTargetSystemRegistry, postSystemRegistryConfig seed, and separation
  from Service guard runtime / monitor slot release. Use when implementing or reviewing
  service startup registration, registry Config rows, ServiceSlot EMPTY/ACTIVE, or
  capacity limits for L3 services.
---

# Target system registry (Config + ServiceSlot)

## One-line rule

**`target-system-registry` is a single declarative Config row (`category=config`) listing fixed `ServiceSlot`s; L3 services claim EMPTY slots at startup; guard maintains `ServiceDetails.runtime`; a future monitor service releases dead slots (`ACTIVE → EMPTY`).**

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
| **Config `ServiceSlot`** | Declared replica count + which instance owns which slot | Seed / ops (layout); `registerService` (`EMPTY→ACTIVE`); monitor (later, `ACTIVE→EMPTY`) |
| **Service `details.runtime`** | Observed health of one instance + its nodes | Service **guard** only |
| **Service catalog** (`discoverService`) | API manifest, lifecycle ACTIVE/DEPRECATED | `postService` / ops — not slot assignment |

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
- **`serviceId`**: id of the **registered runtime** `Service` row, not catalog-only metadata.

---

## SDK layout ([manager-api-service](../manager-api-service/SKILL.md))

| File | Layer | Exports |
|------|-------|---------|
| `config.interface.ts` | types | `Config`, `ConfigDetails`, `CategoryConfig`, `TARGET_SYSTEM_REGISTRY_KEY` |
| `service.interface.ts` | types | `ServiceSlot`, `ServiceSlotStatus`, `ServiceDetails.runtime` |
| `config.api.ts` | API | `getConfig`, `postSystemRegistryConfig`, `buildEmptyServiceSlots`, `buildSystemRegistryConfigDetails` |
| `registry.service.ts` | Service | `getTargetSystemRegistry`, `registerService`, `registerServiceAtStartup`, `resolveActiveRegistryServiceId`, `patchServiceRuntime`, `parseServiceSlot(s)` |
| `scripts/seed-system-registry.ts` | CLI | Idempotent seed |

Public entry: `target-supabase-sdk` (`browser.ts`).

---

## API: seed & read Config

### `postSystemRegistryConfig`

- Inserts the registry row once.
- **Duplicate guard**: `checkRedundancyFilterList` on `category=config` + `value=target-system-registry` ([create-target-redundancy](../create-target-redundancy/SKILL.md)).
- Default slots: `log-service`, `watch-service`, `download-service`, `storage-service` (one EMPTY each).
- Override via payload `slots: [{ serviceValue }]`.

### `getConfig({ value })`

Generic Config read; registry uses `value: TARGET_SYSTEM_REGISTRY_KEY`.

### Seed script (idempotent)

```bash
pnpm seed:system-registry
pnpm seed:system-registry -- --file scripts/system-registry.seed.json
```

1. `getConfig` — if exists, exit 0  
2. else `postSystemRegistryConfig`  
3. catch `isCreateTargetAlreadyExistsError` on race

---

## Service: `registerService`

**Only** `EMPTY → ACTIVE`. Does **not** write heartbeats or release slots.

Flow:

1. Load registry Config  
2. **Idempotent**: if `service.id` already owns an ACTIVE slot → return  
3. Reject if `service.value` not declared in any slot → `SERVICE_NOT_DECLARED`  
4. Find first `EMPTY` slot with matching `serviceValue` → else `SERVICE_SLOTS_FULL`  
5. Set `serviceId = service.id`, `status = ACTIVE`  
6. `updateTargetDetails` with `optimisticLockFilterList: details->meta->>revision` ([optimistic-lock-update](../optimistic-lock-update/SKILL.md))

`parseRegistryRevision` is **module-private** in `registry.service.ts`; do not export meta shape from `config.interface.ts`.

Input:

```typescript
registerService({ service, traceId?, maxAttempts? })
```

`service` = runtime `Service` row (`category=service`), not merely catalog discovery result unless that row is the instance being registered.

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

Owned by separate L3 service:

- Read `getTargetSystemRegistry()` + check `Service.details.runtime` staleness  
- Write Config: `ACTIVE → EMPTY`, clear `serviceId`  
- Uses same `meta.revision` optimistic lock as `registerService`

Do **not** implement stale detection inside `registerService`.

---

## Checklist (new L3 service)

- [ ] Add `{ serviceValue: "<name>" }` to seed slots (or ops updates Config `objects`)  
- [ ] Register runtime `Service` row + guard updating `details.runtime`  
- [ ] On startup: `registerServiceAtStartup({ service })` after instance row exists
- [ ] Guard (or sole TriggerNode runner) calls `patchServiceRuntime({ serviceValue, nodes, lastHeartBeat })`  
- [ ] Do not duplicate capacity in env vars — registry Config is source of truth  
- [ ] Do not store heartbeat in Config `meta` — only `revision`

---

## Anti-patterns

| Avoid | Why |
|-------|-----|
| Nested `maxInstances` + `instances[]` on Config | Use flat `ServiceSlot` rows (declarative replica count) |
| Exporting `SystemRegistryMeta` / rich meta types | Keep `ConfigDetails.meta` as `unknown`; revision parse stays private |
| `registerService` writing `ACTIVE→EMPTY` | Monitor service owns release |
| Heartbeat in registry Config | Belongs on `Service.details.runtime` |
| Using `getTarget` by value for instance identity | Slots bind `serviceId` (row id) |
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
- `src/service/registry.service.ts` — `getTargetSystemRegistry`, `registerService`  
- `src/service/service.interface.ts` — `ServiceSlot`, `ServiceRuntime`  
- `scripts/seed-system-registry.ts` — idempotent seed  
- `scripts/system-registry.seed.json` — example slot list
