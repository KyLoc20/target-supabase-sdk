---
name: task-state-machine
description: >-
  Task status state machine and task.api.ts feature APIs in target-supabase-sdk.
  Use when implementing or reviewing patchChangeTaskStatus, TaskStatusAction, CLAIM,
  patchClaimTask, patchTaskProgress, Zod schemas, optimistic lock filters on task rows,
  worker vs scheduler transition boundaries, or planned DOING reclaim on node LOST.
---

# Task state machine (`src/task/task.api.ts`)

## Public APIs

| API | Role |
|-----|------|
| `patchChangeTaskStatus` | Discriminated union on `action` — all named transitions |
| `patchClaimTask` | Discover TODO by `availableTaskList` → `claimTaskById` |
| `patchTaskProgress` | DOING owner updates `progress` [0, 100] |

All three use **Zod + `validateWithSchema`** (peer dep `zod`). Exported schemas:
`patchChangeTaskStatusSchema`, `patchTaskProgressSchema`, `patchClaimTaskSchema`.

## Actions (`TaskStatusAction`)

| action | from | to | `nodeId` in payload | UPDATE lock |
|--------|------|-----|---------------------|-------------|
| `publish` | OPEN | TODO | no | `status = OPEN` |
| `claim` | TODO | DOING | **required** | `status = TODO` |
| `reset` | TODO | OPEN | **omit** | `status = TODO` |
| `reset` | DOING, DONE | OPEN | **required** | `status ∈ {DOING,DONE}` + `nodeId` |
| `cancel` | DOING | TODO | **required** | `DOING` + `nodeId` |
| `finish` | DOING | DONE | **required** | `DOING` + `nodeId` |
| `close` | OPEN, DONE | CLOSED | no | `status ∈ {OPEN, DONE}` |

### Worker vs scheduler

- **Worker** (requires `nodeId`): `claim`, `cancel`, `finish`, `reset` (failure path), `patchTaskProgress`
- **Scheduler / admin** (no `nodeId`): `publish`, `close`
- **`patchClaimTask`**: worker discovery wrapper around `claim`

### RESET

- **TODO → OPEN**: `{ action: "reset", id }` — no `nodeId`
- **DOING/DONE → OPEN**: `{ action: "reset", id, nodeId }` — owner lock enforced by `lockOnReset`

Attempting DOING/DONE reset without `nodeId` fails optimistic lock (only TODO rows match).

## Internal helpers

| Helper | Purpose |
|--------|---------|
| `transitionTask` | Thin wrapper over `updateTargetDetails` |
| `claimTaskById` | TODO → DOING; shared by `claim` and `patchClaimTask` |
| `lockOnStatus` | Status-only optimistic lock |
| `lockOnDoingOwner` | `DOING` + owner `nodeId` |
| `lockOnReset` | TODO-only, or DOING/DONE + owner when `nodeId` given |
| `clearExecutionState` | Zero progress, null nodeId, clear result |

## Logging

Each public API call: `createLogger({ module, traceId?, labels?, … })` from `shared/log/create-logger.ts`.

- **Core:** `module` (required), `traceId` (optional — inherits orchestrator trace when passed)
- **Business (optional):** other `LogContext` fields, e.g. `nodeId` for worker APIs; omitted lines show `nodeId=--`

Structured details (`taskId`, `status`, …) stay in log entry `context` (see `logTaskTransition`).

## Error handling

Follow [sdk-error-handling](../sdk-error-handling/SKILL.md):

- Expected empty claim → `success(null)`
- Optimistic lock / DB errors → **throw** (do not catch to null in feature APIs)
- Zod validation → throw before any DB call

## Worker integration

```typescript
// Claim (discovery)
const { data: task } = await patchClaimTask({ nodeId, availableTaskList, traceId: loopTraceId });

await patchChangeTaskStatus({ id: taskId, action: TaskStatusAction.FINISH, nodeId, cost, extra, traceId: loopTraceId });
await patchChangeTaskStatus({ id: taskId, action: TaskStatusAction.RESET, nodeId, extra, traceId: loopTraceId });

// Optional during long runs
await patchTaskProgress({ id: taskId, progress: 42, nodeId });
```

## Do not

- Add app-layer pre-update checks between SELECT and UPDATE — use `optimisticLockFilterList` ([optimistic-lock-update](../optimistic-lock-update/SKILL.md))
- Require `nodeId` on `publish` / `close`
- Catch optimistic lock errors inside `patchClaimTask` and return `null`
- Reintroduce `BaseValidator` for these APIs — use Zod schemas
- Put `patchClaimTask` in `node.api.ts` — it lives in `task.api.ts`
- Add per-service schedulers that scan **all** DOING tasks cluster-wide — use **Future plan** below instead

## Future plan — reclaim DOING on node LOST (not implemented)

**Status:** planned SDK work · **do not** implement ad-hoc reclaim runners in L3 consumer services.

### Problem

| Path | TaskNode today | Gap |
|------|----------------|-----|
| In-process failure (`taskFn` throw, prepare fail) | `RESET` → OPEN via `abortTaskRun` | Covered |
| Graceful shutdown (`SIGTERM` → `patchStopNode`) | Node → `LOST`; **in-flight DOING unchanged** | Orphan DOING |
| Hard kill (`kill -9`, OOM) | No shutdown; DOING + dead `nodeId` | Orphan DOING |
| Guard respawns worker | New `nodeId`; `patchClaimTask` only picks **TODO** | Old DOING never reclaimed |

Orphan **DOING** rows block L3 schedulers that use fail-closed open-task checks
(`TODO \| DOING` for same `task.value`). New worker cannot `FINISH` / `CANCEL` /
`RESET` them — optimistic lock requires the **original** owner `nodeId`.

### Planned behavior

When a Node is considered offline (`NodeStatus.LOST`):

1. **Reclaim tasks owned by that node** — for each Task where
   `details.status = DOING` and `details.nodeId = <nodeId>`:
   `patchChangeTaskStatus({ action: cancel, id, nodeId, traceId })` → **TODO**
   (clears execution state per existing `CANCEL` transition).
2. **Idempotent** — safe if called twice; lock is `DOING + nodeId`.
3. **Best-effort per task** — log and continue on individual optimistic-lock failures.

### Triggers (SDK-owned)

| Trigger | When | Notes |
|---------|------|-------|
| **`patchStopNode`** | `BaseNodeRuntime.runShutdown` (SIGTERM / SIGINT) | Primary graceful path; aligns with existing TODO for `DRAINING` first |
| **Stale node → LOST** | Heartbeat older than `taskNodeStaleMs` with no fresh peer | Companion for `kill -9`; may live in guard tick or node janitor — **not** in consumer schedulers |

`ServiceGuardNode` today respawns worker on stale TaskNode but **does not** patch Node
to `LOST` nor reclaim tasks — that split is intentional short-term; reclaim on `LOST`
closes the loop.

### Sequencing with `DRAINING` (same initiative)

`patchStopNode` already has a TODO: wait for in-flight work, use `NodeStatus.DRAINING`
before `LOST`. Recommended order:

```text
BUSY → DRAINING (stop new claims; finish or abort in-flight)
     → LOST (patchStopNode)
     → reclaim DOING owned by nodeId (CANCEL → TODO)
```

Until `DRAINING` exists, **LOST + reclaim** is still valuable for graceful shutdown
and any path that sets `LOST` without waiting.

### Implementation sketch (SDK)

- New helper e.g. `reclaimDoingTasksForNode({ nodeId, traceId })` in `task.api.ts`
  or called from `patchStopNode` / node-offline hook.
- Scan: `category = task`, `details->>status = DOING`, `details->>nodeId = nodeId`
  (paginate; cap per tick if needed).
- Use existing `CANCEL` action — no new state-machine edge.
- Unit/integration tests: graceful stop mid-task; stale node; double reclaim.

### Consumer guidance (L3 services)

- **Do not** ship service-local `reclaim-stuck-tasks` runners that scan global DOING.
- Keep fail-closed scheduler checks (`TODO \| DOING`) — correct once SDK reclaims on `LOST`.
- Document ops dependency until shipped: manual `CANCEL` with owner `nodeId`, or platform monitor.

## Related skills

- [task-local-discovery](../task-local-discovery/SKILL.md) — prepareTask, worker bootstrap
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — lock filter pattern
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — throw vs null
- [service-guard](../service-guard/SKILL.md) — worker respawn; future stale-node → LOST + reclaim
- [queue-delivery-semantics](../queue-delivery-semantics/SKILL.md) — DOING orphan recovery

## Reference

- Implementation: `src/task/task.api.ts`
- Node shutdown: `src/node/node.api.ts` (`patchStopNode`)
- Types: `src/task/task.interface.ts` (`TaskStatus`, `TaskDetails`, `ResultCode`)
- Worker caller: `src/task/task-node.ts` (`TaskNode`)
