---
name: json-state-store
description: >-
  JSON file-backed cross-process state for target-supabase-sdk/node:
  createJsonFileStateStore with nested key merge and atomic writes.
  Use with ServiceReadyGate for main/guard/worker coordination.
---

# JSON state store (target-supabase-sdk/node)

## Import

```typescript
import { createJsonFileStateStore } from "target-supabase-sdk/node";
```

Location: `src/node/fs/json-state-store.ts`

## Usage

```typescript
const store = createJsonFileStateStore({
  filePath: join(dataDir, "state.json"),
  defaultState: DEFAULT_STATE,
  nestedKeys: ["readiness", "guard", "worker"],
  updatedAtKey: "updatedAt",
});

await store.read();
await store.write({ worker: { ready: true } });
await store.reset();
```

Schema for L3 services: use **`createServiceRuntimeStateStore`** — see [watch-service SKILL](../../watch-service/.cursor/skills/watch-service/SKILL.md) **Runtime state** section. Low-level `createJsonFileStateStore` remains for non-L3 or custom shapes.

Pair with `ServiceReadyGate` + `waitForServiceReady` from the same node entry.

See storage-service `src/lib/runtime-state.ts` and process-ipc skill.
