---
name: observability
description: >-
  TaskNode liveness and task queue helpers for target-supabase-sdk:
  evaluateBusyNodeLiveness, countTasksByType, summarizeTaskQueue.
  Use when building /health, /observability, or supervisor TaskNode guards.
---

# Observability helpers (target-supabase-sdk)

## Import

```typescript
import {
  evaluateBusyNodeLiveness,
  countTasksByType,
  summarizeTaskQueue,
  CategoryNode,
  CategoryTask,
  TaskStatus,
  scanTargetList,
  type Node,
  type Task,
} from "target-supabase-sdk";
```

Location: `src/node/node-liveness.ts`, `src/task/task-queue.ts`

## Phase 1 — TaskNode liveness

Pure function over a scanned node list (no I/O):

```typescript
const { data: nodes = [] } = await scanTargetList<Node>({
  category: CategoryNode.NODE,
  maxRows: 200,
});

// Observability: report freshest BUSY worker, healthy if heartbeat is fresh
const taskNode = evaluateBusyNodeLiveness(nodes, { staleMs });

// Supervisor: exclude self, only treat fresh peers as healthy
const peer = evaluateBusyNodeLiveness(nodes, {
  staleMs,
  excludeNodeId: selfNodeId,
  onlyFreshCandidates: true,
});
```

| Option | Default | Purpose |
|--------|---------|---------|
| `staleMs` | — | Max heartbeat age |
| `excludeNodeId` | — | Skip supervisor/trigger self |
| `onlyFreshCandidates` | `false` | `true` = supervisor spawn guard semantics |

## Phase 2 — task queue counts

```typescript
const { data: tasks = [] } = await scanTargetList<Task>({
  category: CategoryTask.TASK,
  maxRows: 500,
});

const counts = countTasksByType(tasks, "create-parcel", [TaskStatus.TODO, TaskStatus.DOING]);
const backlog = summarizeTaskQueue(tasks, "create-parcel", [TaskStatus.TODO, TaskStatus.DOING]);
```

Task type strings stay in each service (L3).

## L3 in each service

Keep in the service layer:

- External probes (Telegram, S3, …)
- Cross-process runtime state (`state.json`)
- Composite snapshot shape and `ok` aggregation
- Express routes

See storage-service `src/observability.ts` for the reference L3 wiring.
