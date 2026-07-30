---
name: create-target-redundancy
description: >-
  Redundancy and concurrency strategy for createTarget in target-supabase-sdk.
  Use when implementing or reviewing create flows (file-list, review, stop-node task),
  checkRedundancyFilterList, duplicate prevention, upsert/ON CONFLICT evaluation,
  or planning RPC migrations for atomic INSERT.
---

# Create target redundancy (target-supabase-sdk)

## Current decision (do not change without explicit request)

**Keep optimistic insert in `createTarget` — do NOT switch to Supabase `.upsert()` / `ON CONFLICT` yet.**

Rationale documented below. Future hardening should prefer **RPC** or **DB constraints** when schema work is allowed.

## Problem: pre-check SELECT → INSERT (removed)

```text
A: SELECT (no match) ──────────────── INSERT ✓
B:      SELECT (no match) ─ INSERT ✓  → duplicate rows (TOCTOU)
```

Also, `maybeSingle()` / `getPossibleTarget` on redundancy SELECT fails when duplicates already exist (PGRST116 on ≥2 rows) — uniqueness-required, not flaky. See [target-list-query](../target-list-query/SKILL.md) § `getPossibleTarget`.

**Do not reintroduce** pre-check-only redundancy before INSERT.

## Current implementation (SDK)

Location: `src/core.api.ts` — `createTarget`

**Optimistic insert + post-verify + rollback:**

1. `INSERT` row via `createFn(validPayload)`
2. If `checkRedundancyFilterList` is set → `SELECT id` with `applyQueryFilters`, **`limit(2)`**
3. If **other** rows match filters → `DELETE` new row, throw `CREATE_TARGET_ALREADY_EXISTS_MESSAGE`
4. If inserted row does not appear in verify results → `console.warn` (createFn / filterList mismatch)

`createTarget.upsert` is **deprecated and ignored** — do not use; upsert belongs in domain patch APIs or future RPC.

Callers: `isCreateTargetAlreadyExistsError(error)` — propagate, do not catch inside feature APIs (see [sdk-error-handling](../sdk-error-handling/SKILL.md))

### Example (`checkRedundancyFilterList`)

```typescript
return createTarget<FileList, PostCreateFileListPayload>({
  payload,
  validator: PostCreateFileListValidator,
  checkRedundancyFilterList: [
    { field: "category", operator: "eq", value: CategoryFileList.FILE_LIST },
    { field: "details->>dirName", operator: "eq", value: payload.dirName },
    { field: "details->>storageUrl", operator: "eq", value: payload.storageUrl },
  ],
  createFn: (validPayload) => ({ /* ... */ }),
});
```

JSON details: `details->>fieldName`. Operators: `eq`, `neq`, `in` (see [optimistic-lock-update](../optimistic-lock-update/SKILL.md)).

### Known limitations (current approach)

| Limitation | Impact |
|------------|--------|
| No DB UNIQUE constraint | Brief window where two rows may be visible between INSERT and post-check |
| Both writers may lose | Two concurrent inserts → both rollback → both throw; caller may retry |
| Rollback DELETE can fail | Orphan duplicate possible if DELETE fails after conflict detected |
| Not industry “gold standard” | Acceptable interim when schema cannot change |

This is **better than pre-check** but **weaker than** single-statement DB atomicity.

---

## Industry alternatives (evaluation)

Ranked by strength for duplicate prevention on `target`:

| Approach | Atomic? | Fits SDK today? | Notes |
|----------|---------|-----------------|-------|
| **UNIQUE index + `ON CONFLICT`** | ✅ | ⚠️ Partial | Best for simple column uniqueness |
| **RPC `INSERT … WHERE NOT EXISTS`** | ✅ | ✅ via migration | Best for complex JSON / status filters |
| **INSERT → verify → DELETE (current)** | ⚠️ | ✅ implemented | No schema change |
| **SELECT → INSERT (old)** | ❌ | removed | TOCTOU |
| **SELECT FOR UPDATE / serializable txn** | ✅ | ❌ | Needs transaction/RPC; blocks |
| **Idempotency-Key (HTTP layer)** | ✅ for retries | N/A in SDK | Complements DB uniqueness; does not replace it |
| **Advisory / distributed lock** | ✅ | ❌ | Multi-instance scheduler only |

---

## Supabase JS `.upsert()` — documented, not adopted

Supabase client supports PostgreSQL upsert:

```typescript
await supabase.client
  .from("target")
  .upsert(row, { onConflict: "category,value" }) // default: DO UPDATE
  .select()
  .single();

await supabase.client
  .from("target")
  .upsert(row, { onConflict: "id", ignoreDuplicates: true }); // DO NOTHING
```

| Option | Meaning | Default |
|--------|---------|---------|
| `onConflict` | Comma-separated columns matching a UNIQUE constraint/index | Primary key |
| `ignoreDuplicates` | `true` → `DO NOTHING`; `false` → `DO UPDATE` | `false` |

**Requires** a matching UNIQUE constraint or UNIQUE index in Postgres. Client cannot invent uniqueness from `checkRedundancyFilterList` alone.

### Why we are NOT using upsert (yet)

1. **`checkRedundancyFilterList` is richer than column lists** — e.g. `details->>status IN ('OPEN','TODO','DOING')` is not expressible as `onConflict` alone.

2. **Partial unique indexes are unsupported by PostgREST client** — indexes with `WHERE category = '…' AND details->>'status' IN (…)` need `ON CONFLICT (cols) WHERE predicate`. Supabase JS `onConflict` accepts **columns only**, not predicates. Error:

   ```text
   there is no unique or exclusion constraint matching the ON CONFLICT specification
   ```

   Tracking: [postgrest-js#403](https://github.com/supabase/postgrest-js/issues/403)

3. **Expression indexes on JSON** (`details->>'dirName'`) need careful migration design before `onConflict` can target them.

4. **Product decision:** stay on optimistic insert until schema + RPC path is planned.

### When upsert WOULD be appropriate (future)

Simple, full-column uniqueness with a **non-partial** UNIQUE index, e.g.:

```sql
CREATE UNIQUE INDEX target_file_list_dir_unique
ON target (category, (details->>'dirName'), (details->>'storageUrl'));
```

Then SDK could use `.upsert(..., { onConflict: '...' })` **if** PostgREST exposes those columns for conflict target (verify against migration).

---

## Recommended future improvement: RPC

For complex redundancy (partial conditions, JSON, active-status scopes), prefer a **PostgreSQL function** + `supabase.client.rpc()`.

### Pattern: `INSERT … WHERE NOT EXISTS` (atomic, no partial-index upsert gap)

```sql
CREATE OR REPLACE FUNCTION create_target_if_not_exists(
  p_name text,
  p_category text,
  p_value text,
  p_details jsonb,
  p_tag_list jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF target
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO target (name, category, value, tag_list, details)
  SELECT p_name, p_category, p_value, p_tag_list, p_details
  WHERE NOT EXISTS (
    SELECT 1 FROM target t
    WHERE t.category = p_category
      AND t.value = p_value
      AND t.details->>'stopNodeId' = p_details->>'stopNodeId'
      AND t.details->>'status' IN ('OPEN', 'TODO', 'DOING')
  )
  RETURNING *;

  -- 0 rows → caller treats as "already exists"
END;
$$;
```

SDK wrapper (future):

```typescript
const { data, error } = await supabase.client.rpc("create_target_if_not_exists", {
  p_name: newTarget.name,
  p_category: newTarget.category,
  // ...
});
if (error) handleSupabaseError("createTarget", error, "...");
if (data == null || data.length === 0) {
  throw new Error(CREATE_TARGET_ALREADY_EXISTS_MESSAGE);
}
return generateResponse.success<T>(data[0]);
```

### RPC vs upsert vs optimistic insert

| Need | Prefer |
|------|--------|
| Simple `(category, value)` unique | UNIQUE index + `.upsert()` |
| Partial / JSON / status-scoped uniqueness | RPC `INSERT WHERE NOT EXISTS` |
| No migration yet | Current optimistic insert in `createTarget` |

### Migration checklist (when implementing RPC)

- [ ] Add SQL function(s) per domain or one parameterized function with clear contracts
- [ ] Grant `EXECUTE` to appropriate roles; use `SECURITY DEFINER` only if needed
- [ ] Add partial UNIQUE indexes where they add defense-in-depth
- [ ] Extend `createTarget` with optional `rpcFn` **or** domain APIs call RPC directly
- [ ] Map empty result / `23505` to `CREATE_TARGET_ALREADY_EXISTS_MESSAGE` for caller compatibility
- [ ] Document in this skill which APIs migrated off optimistic insert
- [ ] Update [sdk-error-handling](../sdk-error-handling/SKILL.md) if error envelope changes

---

## Do not do (until decision changes)

- Replace `createTarget` with `.upsert()` without UNIQUE indexes and PostgREST conflict-target verification
- Assume `.upsert({ onConflict })` works with partial unique indexes
- Reintroduce SELECT-before-INSERT redundancy check as the only guard
- Catch `CREATE_TARGET_ALREADY_EXISTS_MESSAGE` inside feature APIs and return `null` (same rule as optimistic lock on UPDATE)

## Reference

| Item | Location |
|------|----------|
| `createTarget`, constants | `src/core.api.ts` |
| `checkRedundancyFilterList` usage | `src/file-list/file-list.api.ts`, `src/review/review.api.ts`, `src/node/node.api.ts` |
| UPDATE optimistic lock (related) | [optimistic-lock-update](../optimistic-lock-update/SKILL.md) |
| Error propagation | [sdk-error-handling](../sdk-error-handling/SKILL.md) |
| Supabase upsert docs | https://supabase.com/docs/reference/javascript/upsert |
