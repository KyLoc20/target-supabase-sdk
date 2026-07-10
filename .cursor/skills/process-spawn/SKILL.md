---
name: process-spawn
description: >-
  Node child-process spawn utilities in target-supabase-sdk/node: buildNodeImportArgs,
  spawnTsxChild, ManagedChildProcesses. Use when implementing service main/supervisor/worker
  launchers, Windows-safe --import paths, or graceful SIGTERM/SIGKILL shutdown.
---

# Process spawn (target-supabase-sdk/node)

## Import

```typescript
import {
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
| **L3** | Each service `launcher.ts` | script paths, `writeRuntimeState`, spawn-owner rules |

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

## Reference implementation

`storage-service/src/processes/launcher.ts` — L3 wrapper over SDK.

## Do not

- Share one `ManagedChildProcesses` across main and supervisor processes
- Put service-specific `state.json` schema inside SDK
- Spawn worker from main when supervisor owns spawn (storage-service rule)
- Forget `extraPids` from cross-process state on shutdown — see storage-service skill `process-ipc`
