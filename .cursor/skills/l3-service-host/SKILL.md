---
name: l3-service-host
description: >-
  Reusable L3 service startup via target-supabase-sdk: createServiceHost,
  createL3ChildLauncher (main→guard; guard→scheduler+worker), claimServiceRegistrySlot,
  ManagedChildProcesses + criticalSupervisors ["guard"], applyRegistrySlotGuardStep.
  Blueprint: watch-service. Use when adding or migrating L3 services, wiring spawn/stop,
  or reviewing runSingleProcessService (non-L3 one-process tools only).
---

# L3 service host (target-supabase-sdk)

## One-line rule

**Registry claim/release and child spawn live in the SDK; each L3 service supplies bootstrap, Guard/scheduler/worker entries, readiness, and Express routes.**

---

## Layers

| Layer | Export | Role |
|-------|--------|------|
| Registry lifecycle | `claimServiceRegistrySlot`, `runRegistrySlotGuardCheck`, `RegistrySlotRuntimeState` | browser — preflight, claim, orphan cleanup |
| Multi-process host | `createServiceHost` | node — main `index.ts` for all L3 services (watch/log/upload/gc/cv/download) |
| Child launcher | `createL3ChildLauncher`, `ManagedChildProcesses` | node — main→guard; Guard→scheduler+worker; extras (chrome-sidecar) stay local |
| Single-process | `runSingleProcessService` | node — optional non-L3 one-process tools (**not** log-service; log is four-process) |
| Guard step | `ServiceGuardNode`, `applyRegistrySlotGuardStep` | node — guard process; silent on heartbeat loss |
| Log spool | `enableLogSpoolFromEnvInChild`, `shutdownLogSpool` | node — file spool; **no** `waitForAllProcessesReady` |

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
  startSupervisors: () => { spawnGuard(); },
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

```typescript
// src/processes/launcher.ts
import { createL3ChildLauncher } from "target-supabase-sdk/node";

export const {
  spawnGuard,
  spawnBusinessNodes,
  stopBusinessNodes,
  isBusinessReady,
  stopChildProcesses,
} = createL3ChildLauncher({ childProcesses, readRuntimeState, writeRuntimeState });
```

Launcher spawns via `childProcesses.spawn(label, script)` — when main has set `LOG_SPOOL_SERVICE_ID` after registry claim, spawn **auto-injects** `LOG_SPOOL_SERVICE_ID` + `LOG_PERSIST_PROCESS` for labels `main|guard|scheduler|worker`. Explicit `buildLogSpoolSpawnEnv` is optional.

---

L3 services always use **`createServiceHost` + `createL3ChildLauncher`**. Blueprint: [watch-service](../../../watch-service/.cursor/skills/watch-service/SKILL.md).

---

## Single-process template (`runSingleProcessService`)

Not the L3 default. Use only for a one-process tool that still needs a registry slot. **log-service is multi-process** (`createServiceHost`).

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
| `readiness` | guard (`runReadinessGate` before spawn) |
| `guard` | Guard process (`mode` / `silent*` included) |
| `scheduler` | launcher pid + scheduler `ready` / `finishRunnerTick` |
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
Guard process state lives in the `guard` slice (`lastCheckAt`, `lastDecision`, `lastSpawnAt`, `spawnCount`, `mode` / `silent*`).
Scheduler slice includes `pid` / `ready` / `readyAt` (written by the scheduler process).

**Do not** use monolithic `state.json` with multi-process RMW — see [json-state-store](../json-state-store/SKILL.md).

---

## Observability

- Docker **`/health*`**: local process liveness (`readiness.passed` + registry). Stay **200** in silent mode so the container is not restarted.
- **`/observability`**: include `isGuardAvailable(runtime.guard)` in `ok`; tolerate scan failure when offline.
- Business routes: **503** + `Retry-After` from `guardRetryAfterSec` while silent.

See [guard-silent-mode](../guard-silent-mode/SKILL.md).

---

## Related skills

- [service-guard](../service-guard/SKILL.md) — guard process API
- [guard-silent-mode](../guard-silent-mode/SKILL.md) — silent mode + spawn ownership
- [target-system-registry](../target-system-registry/SKILL.md) — slot semantics
- [log-spool](../log-spool/SKILL.md) — file spool + guard collect-log
- [process-spawn](../process-spawn/SKILL.md) — `ManagedChildProcesses`, extraPids
- [json-state-store](../json-state-store/SKILL.md) — sharded runtime state + Windows RMW pitfall
- [node-service-build](../../../watch-service/.cursor/skills/node-service-build/SKILL.md) — esbuild dist entries
