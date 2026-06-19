---
name: sdk-error-handling
description: >-
  Error-handling boundaries for target-supabase-sdk. Use when implementing or reviewing
  SDK functions (patchClaimTask, updateTargetDetails), deciding throw vs SupabaseResponse,
  null vs error.code, try/catch placement, or RPC-style error envelopes.
---

# SDK error-handling boundaries (target-supabase-sdk)

## Current status (keep for now)

**Feature APIs propagate throws; callers catch.** `patchClaimTask` follows this model today.

| Outcome | Current behavior |
|---------|------------------|
| No TODO task | `generateResponse.success(null)` |
| Claim succeeded | `generateResponse.success(Task)` |
| Optimistic lock / DB failure | **Throw** from `updateTargetDetails` — caller uses `isOptimisticLockError` |

Do not catch lock conflicts inside `patchClaimTask` and return `null` — that conflates "no task" with "lost race".

## Core rule (today)

**Core throws. Feature API composes core and propagates. Application decides retry / logging policy.**

Do not wrap lower-layer throws in try/catch at the feature API unless that behavior is an explicit, documented contract (see **Future direction** below — not implemented yet).

## Layer responsibilities

| Layer | Role | Errors (today) |
|-------|------|----------------|
| **Core** (`updateTargetDetails`, `createTarget`, `getPossibleTarget`) | DB read/write, optimistic lock on UPDATE; optimistic insert on CREATE | Throw (`handleSupabaseError`, lock / redundancy messages, missing row) |
| **Feature API** (`patchClaimTask`, `patchUpsertReview`) | Compose core into a use case | **Propagate** — no catch-to-null |
| **Application** (node scheduler, app UI) | Business policy | try/catch, `isOptimisticLockError`, retry, monitoring |

## `null` vs `throw` (today)

| Meaning | Mechanism | Example |
|---------|-----------|---------|
| Expected empty outcome | `generateResponse.success(null)` | No TODO task matches filters |
| Contention / conflict | **Throw** | Optimistic lock failed; create redundancy conflict (`isCreateTargetAlreadyExistsError`) |
| Infrastructure / validation failure | **Throw** | DB error, missing target |

## Caller pattern (today — `patchClaimTask`)

```typescript
import { patchClaimTask, isOptimisticLockError } from "target-supabase-sdk";

try {
  const { data } = await patchClaimTask({ nodeId, availableTaskList });
  if (data == null) {
    // No matching TODO task — idle or poll again later
    return;
  }
  await runTask(data);
} catch (error) {
  if (isOptimisticLockError(error)) {
    // Another node claimed it — retry or pick next (caller policy)
    return;
  }
  throw error;
}
```

Helpers: `isOptimisticLockError`, `OPTIMISTIC_LOCK_FAILED_MESSAGE`, `isCreateTargetAlreadyExistsError`, `CREATE_TARGET_ALREADY_EXISTS_MESSAGE` — `src/core.api.ts`. Create redundancy strategy: [create-target-redundancy](../create-target-redundancy/SKILL.md).

## Logging

- **Feature API:** operational `console.log` for traceability (attempt / success / empty) is OK
- **Do not** use catch-and-log to replace throw for errors callers must react to (today)
- **Application** owns warn/error for retries and monitoring

## Returning data after PATCH

Returning the **full updated row** after a successful claim/patch is appropriate (`updateTargetDetails` already `.select()`). Map to slimmer DTOs at the app layer if needed.

---

## Future direction (evaluated, not implemented)

Treat selected **public RPC-style APIs** (e.g. `patchClaimTask`) as a single API call where **all outcomes live in `SupabaseResponse`** — no throw to the caller. **Core still throws**; the RPC boundary catches and maps.

### Two-layer model (target)

| Layer | Behavior |
|-------|----------|
| **Core** | Keep throwing |
| **Public RPC API** | try/catch → `generateResponse.success` / `generateResponse.error`; internal details logged, not exposed |

This does **not** contradict "callers decide policy": the app reads `success` and `error.code` instead of try/catch.

### Proposed outcome matrix (`patchClaimTask` pilot)

| Scenario | `success` | `status_code` | `data` | `error.code` |
|----------|-----------|---------------|--------|--------------|
| Claimed | `true` | 200 | `Task` | — |
| No TODO task | `true` | 200 | `null` | optional `NO_TASK_AVAILABLE` |
| Empty `availableTaskList` | `false` | 400 | — | `EMPTY_TASK_LIST` |
| Optimistic lock lost | `false` | 409 | — | `LOCK_CONFLICT` |
| Unknown / DB | `false` | 500 | — | `INTERNAL_ERROR` (generic message to caller) |

Suggested codes:

```typescript
// Future — not in codebase yet
EMPTY_TASK_LIST | NO_TASK_AVAILABLE | LOCK_CONFLICT | INTERNAL_ERROR
```

Extend `StatusCode` beyond `200 | 400` when implementing (e.g. 409, 500).

### Why consider this later

- Scheduler loops prefer `if (!res.success) switch (res.error.code)` over try/catch
- Separates "no work" from "contention" without overloading `null`
- Aligns with HTTP/RPC gateways mapping `SupabaseResponse` → HTTP status

### Migration notes (when implementing)

1. Pilot on `patchClaimTask` only; do not rewrite all SDK APIs at once
2. Add error-code enum + mapping helper (core throw → `generateResponse.error`)
3. Log real errors internally; expose sanitized `error.message` for `INTERNAL_ERROR`
4. Update this skill's **Current status** section to reflect RPC model
5. Keep [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — lock still enforced in Core

---

## Do not

- Reintroduce `beforeUpdateValidator` (see [optimistic-lock-update](../optimistic-lock-update/SKILL.md))
- Catch `isOptimisticLockError` inside `patchClaimTask` and return `null` (**today**)
- Use `generateResponse.success(null)` for failures that need retry semantics (**today**)
- Implement RPC envelope on one function without documenting the two-layer model in this skill

## Reference

- Optimistic lock: `.cursor/skills/optimistic-lock-update/SKILL.md`
- Response envelope: `src/core.interface.ts` — `SupabaseResponse`, `generateResponse`
- Core: `src/core.api.ts` — `updateTargetDetails`, `isOptimisticLockError`
- Feature API: `src/task/task.api.ts` — `patchClaimTask`, `patchChangeTaskStatus`
