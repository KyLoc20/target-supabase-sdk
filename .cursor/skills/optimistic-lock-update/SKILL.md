---
name: optimistic-lock-update
description: >-
  Implements DB-level optimistic locking for target-supabase-sdk read-modify-write flows.
  Use when updating target.details via updateTargetDetails, claiming tasks, or replacing
  beforeUpdateValidator / app-layer pre-update checks with UPDATE WHERE conditions.
---

# Optimistic lock on UPDATE (target-supabase-sdk)

## Rule

For concurrent-sensitive updates, **never** rely on:

1. SELECT → validate in app code → UPDATE with only `.eq("id", id)`

That is not atomic. Two writers can both pass validation and overwrite each other.

**Use `updateTargetDetails` with `optimisticLockFilterList`** so expected state is checked in the **UPDATE WHERE clause**.

## API

```typescript
await updateTargetDetails<Task, TaskDetails>({
  id: taskId,
  optimisticLockFilterList: [
    { field: "details->>status", operator: "eq", value: TaskStatus.TODO },
  ],
  updateFn: (details) => ({
    ...details,
    status: TaskStatus.DOING,
    nodeId,
  }),
});
```

### Parameters (`UpdateTargetDetailsParams`)

| Field | Purpose |
|-------|---------|
| `id` | Target row id |
| `updateFn` | Build new details from freshly SELECTed row (still not a lock) |
| `updateExtraFn` | Optional extra field update |
| `optimisticLockFilterList` | **Lock.** `QueryFilter[]` applied on UPDATE via `applyQueryFilters` |

### Failure behavior

- UPDATE uses `.select().maybeSingle()`
- `data === null` + non-empty lock filters → throws (`OPTIMISTIC_LOCK_FAILED_MESSAGE`)
- **Do not catch inside feature APIs** — callers use `isOptimisticLockError` (see [sdk-error-handling](../sdk-error-handling/SKILL.md))

## QueryFilter operators

- `eq` — single value match
- `neq` — single value not equal
- `in` — any value in array (PostgREST `.in()`)

JSON details columns: `details->>fieldName`

## Do not reintroduce

- `beforeUpdateValidator` on `updateTargetDetails` (removed; use lock filters instead)
- Stale details from an earlier query passed into UPDATE without lock conditions

## When lock filters are optional

Updates with no concurrency risk (e.g. heartbeat timestamp on a single node row) may omit `optimisticLockFilterList`.

## Optimistic create (`createTarget`)

Pre-check `SELECT` → `INSERT` is **not atomic** — do not use it.

Current SDK behavior: **insert-first + post-verify + rollback** on `checkRedundancyFilterList` conflict.

For limitations, industry comparison, why **not** `.upsert()` yet, and **RPC migration plan**, see [create-target-redundancy](../create-target-redundancy/SKILL.md).

Callers: `isCreateTargetAlreadyExistsError` — same propagate pattern as UPDATE lock failures.

## Reference

Implementation: `src/core.api.ts` — `updateTargetDetails`, `createTarget`, `applyQueryFilters`

Example: `src/node/node.api.ts` — `patchClaimTask`
