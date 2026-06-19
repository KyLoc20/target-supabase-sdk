---
name: task-state-machine
description: >-
  Task status state machine and task.api.ts feature APIs in target-supabase-sdk.
  Use when implementing or reviewing patchChangeTaskStatus, TaskStatusAction, CLAIM,
  patchClaimTask, patchTaskProgress, Zod schemas, optimistic lock filters on task rows,
  or worker vs scheduler transition boundaries.
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

Each public API call: `createApiLogger(module, { traceId?, …businessFields })` from `shared/log/create-api-logger.ts`.

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

## Related skills

- [task-local-discovery](../task-local-discovery/SKILL.md) — prepareTask, worker bootstrap
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — lock filter pattern
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — throw vs null

## Reference

- Implementation: `src/task/task.api.ts`
- Types: `src/task/task.interface.ts` (`TaskStatus`, `TaskDetails`, `ResultCode`)
- Worker caller: `src/node/node-manager.ts`
