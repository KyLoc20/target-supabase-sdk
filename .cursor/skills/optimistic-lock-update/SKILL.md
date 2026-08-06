---
name: optimistic-lock-update
description: >-
  Implements DB-level optimistic locking for target-supabase-sdk read-modify-write flows.
  Use when updating via updateTarget / updateTargetDetails, claiming tasks, or replacing
  beforeUpdateValidator / app-layer pre-update checks with UPDATE WHERE conditions.
---

# Optimistic lock on UPDATE (target-supabase-sdk)

## Rule

For concurrent-sensitive updates, **never** rely on:

1. SELECT → validate in app code → UPDATE with only `.eq("id", id)`

That is not atomic. Two writers can both pass validation and overwrite each other.

**Use `updateTarget` or `updateTargetDetails` with `optimisticLockFilterList`** so expected state is checked in the **UPDATE WHERE clause**.

## Which API

| Need | API |
|------|-----|
| Only `details` (optional `extra`) | `updateTargetDetails` |
| `tagList` and/or `details` / `extra` in one UPDATE | `updateTarget` |
| Full-row create-shaped rewrite | **Do not** — `patchTarget` is deprecated |

`updateTargetDetails` is implemented as a thin wrapper over `updateTarget`.

## API — `updateTarget` (narrow patch)

```typescript
await updateTarget<List, ListDetails>({
  id: wordId,
  optimisticLockFilterList: [
    { field: "details->>loaderKey", operator: "eq", value: "english-word" },
  ],
  updateFn: (row) => ({
    tagList: ["verb", "noun"],
    details: {
      ...row.details,
      meta: { reminder: "書寫" },
      items: ["write", "writes", "writing", "wrote", "written"],
    },
  }),
});
```

Omitted patch keys are left unchanged. Identity columns (`name` / `value` / `category`) are not writable.

### Parameters (`UpdateTargetParams`)

| Field | Purpose |
|-------|---------|
| `id` | Target row id |
| `updateFn` | `(existing) => { tagList?, details?, extra? }` — only returned keys are written |
| `optimisticLockFilterList` | **Lock.** `QueryFilter[]` applied on UPDATE via `applyQueryFilters` |

## API — `updateTargetDetails` (details-only)

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

## Empty UPDATE ambiguity (lock vs not-found)

### Problem

`optimisticLockFilterList` is applied only on **UPDATE**, not on the prior SELECT (SELECT is by `id` only — SDK convention).

When UPDATE returns no row and the lock list is **non-empty**, three distinct situations used to share one error (`OPTIMISTIC_LOCK_FAILED_MESSAGE`):

| Actual situation | Correct semantic |
|------------------|------------------|
| Row deleted between SELECT and UPDATE | not found |
| Lock predicates miss (status/revision/loaderKey/… changed; row still exists) | lock failure |
| True concurrency conflict (another writer won) | lock failure |

Callers that already verified existence (e.g. `getEnglishWordById` then `updateTarget`) **must not** map every lock failure to domain 404 — that races (row existed at read, lock miss ≠ gone).

### Resolution (SDK)

On `data === null` after UPDATE:

1. **No locks** → throw `UPDATE_TARGET_NOT_FOUND_MESSAGE`
2. **Locks non-empty** → re-SELECT by `id` only (no lock filters):
   - row gone → `UPDATE_TARGET_NOT_FOUND_MESSAGE`
   - row still present → `OPTIMISTIC_LOCK_FAILED_MESSAGE`

```text
UPDATE (id + locks) → empty
        │
        ▼
  locks empty? ──yes──► NOT_FOUND
        │ no
        ▼
  SELECT id only
        │
   missing ──► NOT_FOUND
   present ──► OPTIMISTIC_LOCK_FAILED
```

### Caller rules

- Detect lock with `isOptimisticLockError` — retry / conflict handling only
- Detect not-found via message containing `not found` / `NOT exists`, or compare to `UPDATE_TARGET_NOT_FOUND_MESSAGE`
- **Do not** treat lock failure as not-found after a successful pre-read
- Domain APIs may map **not-found** → 404; leave lock failures to propagate (or map to 409/conflict)

### Failure behavior (summary)

- UPDATE uses `.select().maybeSingle()`
- Empty result + empty locks → not-found
- Empty result + locks → re-SELECT disambiguation (above)
- **Do not catch inside feature APIs** for lock — callers use `isOptimisticLockError` (see [sdk-error-handling](../sdk-error-handling/SKILL.md))

## Impact on existing callers (`updateTargetDetails`)

| Path | Behavior change? |
|------|------------------|
| UPDATE succeeds | **None** (no re-SELECT) |
| No locks, UPDATE empty | Still not-found (message may say `[updateTarget]` after wrapper unification) |
| Locks, UPDATE empty, **row deleted** | **Changed**: was always `OPTIMISTIC_LOCK_FAILED` → now **not-found** |
| Locks, UPDATE empty, **row still there** | **None**: still `OPTIMISTIC_LOCK_FAILED` |
| Success-path latency | **None**; extra SELECT only on the rare empty-UPDATE+locks path |

### Practical effect for in-tree users

- **Task claim / status** (`lockOnStatus`, `lockOnDoingOwner`): concurrent status miss → still lock failure + retry. Task **deleted** mid-flight → now not-found instead of lock failure (usually better; avoid pointless lock retries).
- **Config / registry revision locks**: revision miss while Config row exists → still lock failure. Config row deleted → not-found.
- **Extraction / trigger / node**: same split.
- Callers that only branch on `isOptimisticLockError` for retry: delete case no longer looks like a lock — they should already handle generic errors / missing target elsewhere.
- Callers that assumed “any empty UPDATE with locks ⇒ lock” and never handled not-found on that path: may now see not-found when the row was deleted — treat as improvement, not a silent success-path break.

## QueryFilter operators

- `eq` — single value match
- `neq` — single value not equal
- `in` — any value in array (PostgREST `.in()`)

JSON details columns: `details->>fieldName`

## Do not reintroduce

- `beforeUpdateValidator` on `updateTargetDetails` (removed; use lock filters instead)
- Stale details from an earlier query passed into UPDATE without lock conditions
- Using deprecated `patchTarget` for business updates (no lock; forces full create-shaped payload; can mutate identity fields)
- Mapping lock failure → not-found in domain catch blocks after a successful pre-read

## When lock filters are optional

Updates with no concurrency risk (e.g. heartbeat timestamp on a single node row) may omit `optimisticLockFilterList`.

## Optimistic create (`createTarget`)

Pre-check `SELECT` → `INSERT` is **not atomic** — do not use it.

Current SDK behavior: **insert-first + post-verify + rollback** on `checkRedundancyFilterList` conflict.

For limitations, industry comparison, why **not** `.upsert()` yet, and **RPC migration plan**, see [create-target-redundancy](../create-target-redundancy/SKILL.md).

Callers: `isCreateTargetAlreadyExistsError` — same propagate pattern as UPDATE lock failures.

## Reference

Implementation: `src/core.api.ts` — `updateTarget`, `updateTargetDetails`, `UPDATE_TARGET_NOT_FOUND_MESSAGE`, `OPTIMISTIC_LOCK_FAILED_MESSAGE`, `createTarget`, `applyQueryFilters`

Example: `src/task/task.api.ts` — `patchClaimTask`, `patchChangeTaskStatus`, `lockOnDoingOwner`
