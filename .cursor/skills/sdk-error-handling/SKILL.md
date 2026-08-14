---
name: sdk-error-handling
description: >-
  Error-handling boundaries for target-supabase-sdk. Use when implementing or reviewing
  *.api.ts public APIs, generateResponse.error vs throw, SupabaseResponse envelopes,
  validateWithSchema, null vs error.code, or core vs feature layer boundaries.
---

# SDK error-handling boundaries (target-supabase-sdk)

## Paradigm: `*.api.ts` never throws

**All public functions in `*.api.ts` return `Promise<SupabaseResponse<T>>` and must not throw to callers.**

| Outcome | Mechanism |
|---------|-----------|
| Success with data | `generateResponse.success(data)` |
| Success, expected empty | `generateResponse.success(null)` |
| Validation / business / infra failure | `generateResponse.error(message, statusCode?, code?)` |

Callers (managers, scripts, UI) branch on `success` / `error` — no try/catch required for normal control flow.

**Core (`core.api.ts`) still throws.** Feature APIs catch at the boundary and map to envelope.

```text
Caller → *.api.ts (envelope, no throw) → core.api.ts (throw) → Supabase
```

---

## Layer responsibilities

| Layer | File pattern | Errors |
|-------|--------------|--------|
| **Core** | `core.api.ts` | Throw (`handleSupabaseError`, optimistic lock, redundancy) |
| **Feature API** | `*.api.ts` | **Never throw** — try/catch core + Zod → `generateResponse` |
| **Manager / worker** | `*-manager.ts`, `scripts/` | Read `error`; may throw for process lifecycle (e.g. worker shutdown) |

Managers may translate `{ error }` into throw when aborting startup — that is **application policy**, not API contract.

---

## Implementation pattern

### 1. Zod validation → envelope (not throw)

`validateWithSchema` throws on invalid input. Wrap the exported API:

```typescript
export const getScanRemoteRepoValues = async (
  payload: GetScanRemoteRepoValuesPayload
): Promise<SupabaseResponse<string[]>> => {
  try {
    return await getScanRemoteRepoValuesValidated(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return generateResponse.error(message) as SupabaseResponse<string[]>;
  }
};

const getScanRemoteRepoValuesValidated = validateWithSchema(
  getScanRemoteRepoValuesSchema,
  "getScanRemoteRepoValuesSchema"
)(async (payload) => { /* ... */ });
```

Future: prefer **`safeParseWithSchema`** from [core-schema](../core-schema/SKILL.md) when the caller needs `{ ok, data } | { ok: false, error }` without throw. `validateWithSchema` remains the default for `*.api.ts` envelope wrappers.

### 2. Core composition → catch → envelope

```typescript
)(async (payload): Promise<SupabaseResponse<Task | null>> => {
  try {
    const { data: possibleTask } = await getPossibleTarget({ filterList });
    if (possibleTask == null) {
      return generateResponse.success(null);
    }
    const data = await claimTaskById({ taskId: possibleTask.id, nodeId });
    return generateResponse.success(data);
  } catch (error) {
    if (isOptimisticLockError(error)) {
      return generateResponse.error(OPTIMISTIC_LOCK_FAILED_MESSAGE, undefined, "OPTIMISTIC_LOCK") as SupabaseResponse<Task | null>;
    }
    const message = error instanceof Error ? error.message : String(error);
    return generateResponse.error(message) as SupabaseResponse<Task | null>;
  }
});
```

Reference: `patchClaimTask`, `getScanRemoteRepoValues`.

### 3. Do not swallow errors silently

- Log inside API when useful (`createLogger`)
- Return `error.code` for machine-readable branches (lock conflict, validation, etc.)
- Do not use `success(null)` for failures that need retry semantics

---

## `null` vs `error`

| Meaning | Mechanism | Example |
|---------|-----------|---------|
| Expected empty outcome | `success: true`, `data: null` | No TODO task matches filters |
| Validation failure | `success: false`, `error` | Invalid Zod payload |
| Contention | `success: false`, `error.code: "OPTIMISTIC_LOCK"` | Lost claim race |
| DB / unknown | `success: false`, `error` | Postgrest error message |

Do not conflate "no task" with "lock lost" — both can use `data: null` only when **success** and empty is expected.

---

## Caller pattern (managers / scripts)

```typescript
const { data, error, success } = await patchClaimTask({ nodeId, availableTaskList });

if (!success || error) {
  logger.error("认领失败", { context: { error: error?.message, code: error?.code } });
  return;
}
if (data == null) {
  // 本轮无任务 — 正常空闲
  return;
}
await runTask(data);
```

Worker startup may still throw after `{ error }` to trigger shutdown — intentional.

---

## Error codes (convention)

Use `error.code` for stable branching:

| Code | When |
|------|------|
| `OPTIMISTIC_LOCK` | Lock / race lost (`isOptimisticLockError`) |
| `VALIDATION` | Zod / payload (optional — message often enough) |
| `EMPTY_TASK_LIST` | Business rule: empty filter list (future) |
| `NO_TASK_AVAILABLE` | Optional on `success(null)` for explicit idle (future) |

Extend `StatusCode` (409, 500) when mapping to HTTP gateways.

Helpers: `isOptimisticLockError`, `OPTIMISTIC_LOCK_FAILED_MESSAGE`, `isCreateTargetAlreadyExistsError` — `src/core.api.ts`.

---

## Migration status

| Module | Status |
|--------|--------|
| `repo.api.ts` — `getScanRemoteRepoValues` | ✅ Envelope, no throw |
| `task.api.ts` — `patchClaimTask` | ✅ Envelope for catch path |
| `task.api.ts` — other exports | ⚠️ Still propagate core throws / Zod throws |
| `node.api.ts`, `command.api.ts`, … | ⚠️ Migrate when touched |

When editing any `*.api.ts`, convert to envelope model in the same PR.

---

## Do not

- Throw from exported `*.api.ts` functions (validation, core, or business)
- Let `validateWithSchema` throw reach callers without an outer envelope wrapper
- Catch `isOptimisticLockError` and return `success(null)` — use `error` + code
- Move envelope logic into `NodeManager` / `TaskManager` — boundary stays in `*.api.ts`
- Make `core.api.ts` return envelopes — keep core throw-based

---

## Reference

- Envelope: `src/core.interface.ts` — `SupabaseResponse`, `generateResponse`
- Core: `src/core.api.ts`
- Examples: `src/repo/repo.api.ts`, `src/task/task.api.ts` (`patchClaimTask`)
- Optimistic lock: [optimistic-lock-update](../optimistic-lock-update/SKILL.md)
- Create redundancy: [create-target-redundancy](../create-target-redundancy/SKILL.md)
