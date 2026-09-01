---
name: process-spawn
description: >-
  Node child-process spawn utilities in target-supabase-sdk/node: createL3ChildLauncher,
  ManagedChildProcesses, buildNodeImportArgs, spawnTsxChild. Use when implementing
  L3 launchers (main→guard; guard→scheduler+worker), Windows-safe --import paths,
  extraPids shutdown, or graceful SIGTERM/SIGKILL.
---

# Process spawn (target-supabase-sdk/node)

## Import

```typescript
import {
  createL3ChildLauncher,
  createManagedChildProcesses,
  buildNodeImportArgs,
  spawnTsxChild,
  isChildProcessRunning,
  ManagedChildProcesses,
} from "target-supabase-sdk/node";
```

## Layers

| Layer | Location | Contents |
|-------|----------|----------|
| **L1** | SDK `process-spawn.ts` | `--import` argv, `spawnTsxChild` |
| **L2** | SDK `ManagedChildProcesses` | label registry, dedupe, `stopAll` |
| **L3** | SDK `createL3ChildLauncher` + each service `launcher.ts` | Guard-owned scheduler+worker; main-owned Guard; service extras (chrome-sidecar) stay local |

## Windows `--import` rule

Always pass **relative** preload paths with `cwd: projectRoot`. Never pass `D:\…` absolutes to `--import` on Node 24 ESM.

## ManagedChildProcesses

Process-local — **one instance per OS process** (main vs supervisor each have their own).

```typescript
const children = new ManagedChildProcesses({
  projectRoot,
  preloadModules: ["./scripts/preload.mjs"],
  logger, // optional createLogger instance
});

const { child, created } = children.spawn("worker", "./src/processes/worker.ts");
if (created) {
  await writeRuntimeState({ worker: { pid: child.pid, ready: false } });
}

await children.stopAll({ extraPids: [orphanWorkerPid] });
```

| Method | Behavior |
|--------|----------|
| `spawn(label, entryScript)` | Dedupe if label already running; returns `{ child, created }` |
| `getRunning(label)` | Running child or null |
| `stopAll({ extraPids })` | SIGTERM tracked children → grace → SIGKILL; then SIGTERM extra PIDs |

## L3 launcher (`createL3ChildLauncher`)

```typescript
import { createL3ChildLauncher } from "target-supabase-sdk/node";

export const {
  spawnGuard,
  spawnBusinessNodes,
  stopBusinessNodes,
  isBusinessReady,
  stopChildProcesses,
} = createL3ChildLauncher({
  childProcesses,
  readRuntimeState,
  writeRuntimeState,
  // spawnEnv: optional; default sets LOG_PERSIST_PROCESS from the spawn label
});
```

`stopBusinessNodes` runs in the **Guard** process. `stopChildProcesses` is main shutdown (`extraPids` for Guard-spawned PIDs). download-service keeps `spawnChromeSidecar` in `launcher.ts` (main-owned).

## Do not

- Share one `ManagedChildProcesses` across main and supervisor processes
- Put service-specific `state.json` schema inside SDK
- Spawn worker from main when Guard owns spawn
- Forget `extraPids` on main shutdown for Guard-spawned scheduler/worker PIDs (read from runtime-state)
