---
name: l3-service-host
description: >-
  Reusable L3 service startup via target-supabase-sdk: claimServiceRegistrySlot,
  createServiceHost (multi-process), runSingleProcessService (log-service style),
  ManagedChildProcesses + critical supervisor exit, applyRegistrySlotGuardStep.
  Use when adding or migrating watch/download/storage/log services off duplicated index.ts boilerplate.
---

# L3 service host (target-supabase-sdk)

## One-line rule

**Registry claim/release lives in the SDK; each L3 service only supplies bootstrap, guard/scheduler/worker processes, readiness, and Express routes.**

---

## Layers

| Layer | Export | Role |
|-------|--------|------|
| Registry lifecycle | `claimServiceRegistrySlot`, `runRegistrySlotGuardCheck`, `RegistrySlotRuntimeState` | browser — preflight, claim, orphan cleanup |
| Multi-process host | `createServiceHost` | node — main index.ts for watch / download / storage |
| Single-process | `runSingleProcessService` | node — log-service (TriggerNode only) |
| Guard step | `ServiceGuardNode`, `applyRegistrySlotGuardStep` | node — guard process |
| Child spawn | `ManagedChildProcesses`, `createManagedChildProcesses` | node — spawn/stop + critical label exit → host shutdown |
| Log-persist gate | `createLogSpoolCoordinator` (optional) | node — file spool; **no** `waitForAllProcessesReady` |

---

## Multi-process template (`createServiceHost`)

```typescript
import { createServiceHost, createClaimedRegistrySlotRuntimeState } from "target-supabase-sdk/node";
import { childProcesses } from "./startup/child-processes";

let bootstrapResult: BootstrapResult | null = null;

createServiceHost({
  serviceValue: SERVICE_VALUE,
  childProcesses,
  criticalSupervisors: ["guard"],

  prepare: async () => { /* reset state, initSupabase */ },
  createInstance: async () => {
    bootstrapResult = await bootstrap(port);
    return bootstrapResult; // { service, baseUrl, ... }
  },
  onRegistryClaimed: async ({ service }) => {
    await writeRuntimeState({ registry: createClaimedRegistrySlotRuntimeState(service) });
  },
  startSupervisors: () => { spawnGuard(); spawnScheduler(); },
  waitUntilReady: async () => { await waitForServiceReady(...); },
  startServer: async () => { /* express listen → { close } */ },
  onShutdown: async () => { await stopChildProcesses(); await shutdownLogSpoolFromEnv(); },
}).run();
```

### `src/startup/child-processes.ts` (per service)

```typescript
import { createManagedChildProcesses } from "target-supabase-sdk/node";
import { projectRoot } from "../env";

export const childProcesses = createManagedChildProcesses({ projectRoot });
```

Launcher spawns via `childProcesses.spawn(label, script)` — when main has set `LOG_SPOOL_SERVICE_ID` after registry claim, spawn **auto-injects** `LOG_SPOOL_SERVICE_ID` + `LOG_PERSIST_PROCESS` for labels `main|guard|scheduler|worker`. Explicit `buildLogSpoolSpawnEnv` is optional.

---

## Single-process template (`runSingleProcessService`)

```typescript
runSingleProcessService({
  serviceValue: SERVICE_VALUE,
  createInstance: bootstrap,
  run: async ({ service, session }) => {
    TriggerManager.registerRunner({ fn: async (ctx) => {
      const guard = await applyRegistrySlotGuardStep({ serviceValue, serviceId: service.id, ... });
      if (!guard.continueTick) return;
      // ...
    }});
    const node = new TriggerNode({
      beforeProcessExit: () => session.release(),
    });
    await node.start();
  },
});
```

---

## Bootstrap contract

- **Always** `postServiceInstance` (SDK) — new instance row each startup (same `value` allowed).
- **`apiKeys: []`** — L3 services do not register Api catalog rows at startup; HTTP routes are code-defined.
- **`initSupabaseFromEnv`** belongs in `createServiceHost.prepare`, not bootstrap.
- **`baseUrl`** — derive in `startServer` via `publicBaseUrl(envPort())`; bootstrap returns `Service` only.

```typescript
import { createLogger, postServiceInstance } from "target-supabase-sdk/node";

const logger = createLogger({ module: "bootstrap" });

export async function bootstrap() {
  return postServiceInstance({ name: "My Service", value: SERVICE_VALUE, logger });
}
```

---

## Runtime state

Cross-process gate: **`createServiceRuntimeStateStore`** (SDK 0.2.5+) — **one JSON file per top-level slice** under `data/runtime/runtime-state/`. Legacy `state.json` migrates automatically.

| Slice | Typical writer |
|-------|----------------|
| `readiness` | main (readiness runner) |
| `guard` | guard process |
| `scheduler` | scheduler (`finishRunnerTick`) |
| `worker` | worker process |
| `registry` | main (`onRegistryClaimed`) + guard slot checks |
| `pipeline` (log-service) | runners via `extraDefaults` |

```typescript
import { createServiceRuntimeStateStore } from "target-supabase-sdk/node";

const runtimeState = createServiceRuntimeStateStore({
  filePath: join(runtimeDataDir(), "state.json"), // resolves to runtime-state/
});
```

Embed SDK type:

```typescript
import type { RegistrySlotRuntimeState } from "target-supabase-sdk";
import { EMPTY_REGISTRY_SLOT_RUNTIME_STATE } from "target-supabase-sdk/node";

registry: RegistrySlotRuntimeState; // default { ...EMPTY_REGISTRY_SLOT_RUNTIME_STATE }
```

Guard runner writes `slotOwned` / `lastSlotCheckAt` via `applyRegistrySlotGuardStep`.
Guard process state lives in the `guard` slice (`lastCheckAt`, `lastDecision`, `lastSpawnAt`, `spawnCount`).

**Do not** use monolithic `state.json` with multi-process RMW — see [json-state-store](../json-state-store/SKILL.md).

---

## Observability

Expose top-level `registry` + include `runtime.registry.slotOwned !== false` in `ok`.

---

## Related skills

- [service-guard](../service-guard/SKILL.md) — guard process API
- [target-system-registry](../target-system-registry/SKILL.md) — slot semantics
- [log-spool](../log-spool/SKILL.md) — file spool + guard collect-log
- [json-state-store](../json-state-store/SKILL.md) — sharded runtime state + Windows RMW pitfall
- [node-service-build](../../../watch-service/.cursor/skills/node-service-build/SKILL.md) — esbuild dist entries
