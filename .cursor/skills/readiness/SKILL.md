---
name: readiness
description: >-
  Composable readiness checks and cross-process service-ready gate for target-supabase-sdk/node:
  runReadinessChecks, createRequiredEnvCheck, createPathsExistCheck, createSupabaseReachableCheck,
  pollUntil, waitForServiceReady. Use when implementing service preflight or main startup gates.
---

# Readiness (target-supabase-sdk/node)

## Import

```typescript
import {
  runReadinessChecks,
  createRequiredEnvCheck,
  createPathsExistCheck,
  createSupabaseReachableCheck,
  pollUntil,
  waitForServiceReady,
  type ServiceReadyGate,
} from "target-supabase-sdk/node";
```

Location: `src/node/readiness/`

## Phase 1 — composable checks

```typescript
const report = await runReadinessChecks([
  createRequiredEnvCheck("supabase_env", ["SUPABASE_URL", "SUPABASE_ANON_KEY"]),
  createPathsExistCheck("task_config", ["/path/to/task.config.js"]),
  createSupabaseReachableCheck(),
  async () => ({ name: "custom", ok: true }),
]);
// report.ok, report.checks, report.message
```

| Factory | Purpose |
|---------|---------|
| `createRequiredEnvCheck` | Env keys non-empty |
| `createPathsExistCheck` | `fs.access` all paths |
| `createSupabaseReachableCheck` | `scanTargetList` probe |

Domain checks (Telegram getMe, task packages) stay in each service.

## Phase 2 — cross-process ready gate

```typescript
const gate: ServiceReadyGate = {
  async read() {
    const state = await readRuntimeState(); // service-specific
    return {
      failed: state.readiness.status === "failed",
      ready: state.readiness.status === "passed" && state.worker.ready,
      failureMessage: state.readiness.message,
      readyDetail: { /* log payload */ },
    };
  },
};

await waitForServiceReady(gate, { timeoutMs: 180_000, logger });
```

`waitForServiceReady`: fail-fast on `failed`, poll until `ready`, optional `formatTimeoutError`.

**IPC:** gate transport (JSON file, HTTP, DB) is service L3 — see storage-service skill `process-ipc`.

## Reference

`storage-service/src/processes/readiness.ts` — L3 checks + gate over sharded runtime state (`readRuntimeState()`).

See [json-state-store](../json-state-store/SKILL.md) — L3 `ServiceReadyGate` is `readiness.passed && worker.ready && scheduler.ready`. Do not omit `scheduler.ready` (all six L3 services have a scheduler process, including noop). Monolithic `state.json` caused silent wipes pre-0.2.5.

## Do not

- Put service-specific checks (Telegram, task paths) in SDK
- Hard-code runtime state schema in SDK — implement `ServiceReadyGate` per service
- Read `state.json` directly — use `readRuntimeState()` (sharded under `runtime-state/` since SDK 0.2.5)
