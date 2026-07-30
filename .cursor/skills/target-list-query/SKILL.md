---
name: target-list-query
description: >-
  Target table query layering in target-supabase-sdk core.api: getTargetList (single page),
  scanTargetList (full scan), getTargetTotalCount, pollTargetList, getPossibleTarget
  (maybeSingle). Use when implementing or reviewing list/fetch-all/pagination loops,
  repo discovery, bootstrap scans, find-by-filter lookups, or deciding getTargetList vs
  scanTargetList vs getPossibleTarget — especially when historical duplicates may exist.
---

# Target list query layering (target-supabase-sdk)

## Core rule

**Feature APIs must not hand-roll `while (pageNum++)` pagination.** Put full-scan loops in core; feature layers map rows to domain shapes.

PostgREST / Supabase enforces a server **max-rows** cap per request — “fetch all in one query” is usually impossible. Pagination is required; **where** it lives matters.

---

## API matrix (`src/core.api.ts`)

| API | Semantics | When to use |
|-----|-----------|-------------|
| `getTarget` | **Exactly one** by `id` — `.single()` | Known PK |
| `getPossibleTarget` | **0 or 1** by `filterList` — `.maybeSingle()` | Only when filter is uniqueness-guaranteed |
| `getTargetList` | **Single page** — explicit `pageNum` + `pageSize` (or `limit`) | UI lists, caller-controlled pagination; **tolerant lookup** (`limit: 1` + `orderBy`) |
| `scanTargetList` | **Full scan** — auto-pages until exhausted | Worker bootstrap, sync jobs, registry discovery |
| `getTargetTotalCount` | Count only (`head: true`) | UI totals, pre-check size |
| `pollTargetList` | **Dequeue** — SELECT batch + DELETE each row | Command queue, at-most-once consumers |

List/scan use `buildCategoryScopedQuery` → always scope by `category` + optional `filterList`.

---

## `getPossibleTarget` — uniqueness-required (footgun)

Location: `src/core.api.ts` — wraps PostgREST / Supabase `.maybeSingle()`.

| Matching rows | Behavior |
|---------------|----------|
| 0 | `null` |
| 1 | that row |
| ≥2 | **throws** (PGRST116 — “JSON object requested, multiple rows returned”; SDK: `Failed to fetch target.`) |

**Not a flaky bug** — the contract **requires** uniqueness. Unreliable only when callers use non-unique filters (logical key without DB UNIQUE, or historical duplicate debt).

### Incident (log-service Tier 0, 2026-07)

1. Older writer created **duplicate** `LogTrace` rows per same `traceId` (`value`).
2. Merge used `getPossibleTarget` → PGRST116 on duplicates → merge failed → source `LogBatch` kept → oldest-first scan head-of-line stall (Tier 0 appeared dead while scheduler still “succeeded”).
3. Fix: `getTargetList` with `limit: 1`, `orderBy: { field: "created_at", ascending: true }` (oldest canonical row). Never `getPossibleTarget` / `maybeSingle` for that lookup.

Related: log-service skill Tier 0 lessons; create redundancy also notes `maybeSingle` on duplicate-prone SELECT — see [create-target-redundancy](../create-target-redundancy/SKILL.md).

### Rules

| Situation | Prefer |
|-----------|--------|
| Filter matches PK / UNIQUE / proven single row | `getPossibleTarget` OK |
| “Should be unique” but history may have duplicates | `getTargetList` + `limit: 1` + explicit `orderBy` (pick canonical row) |
| Need to know if duplicates exist | `getTargetList` with `limit ≥ 2` (or count); do not rely on maybeSingle throwing as the only signal |

```typescript
// Tolerant lookup — duplicates OK
const { data = [] } = await getTargetList<List>({
  category: CategoryList.LIST,
  filterList: [/* value + loaderKey … */],
  limit: 1,
  orderBy: { field: "created_at", ascending: true },
});
const row = data[0] ?? null;
```

### Do not

- Use `getPossibleTarget` for merge / idempotent create-or-patch when duplicate rows may exist
- “Fix” `.maybeSingle()` to silently return the first of many rows — that hides data-integrity debt
- Treat PGRST116 as transient network noise — it means **cardinality ≠ 0|1**

### Future optimization (deferred)

Do **not** delete `getPossibleTarget` yet — still valid for truly unique filters (config, extraction, service slot helpers, etc.).

Consider later (explicit decision):

1. **Docs / JSDoc** — mark as *uniqueness-required*; document PGRST116 on ≥2 rows
2. **Soft-deprecate** — steer new code to `getTargetList({ limit: 1, orderBy })` when uniqueness is soft
3. **Hardening** — optional DB UNIQUE + GC for known logical keys (e.g. LogTrace `value` + loaderKey)
4. **Do not** change maybeSingle semantics to auto-pick one row

---

## `scanTargetList` (atomic full-scan primitive)

```typescript
const { data } = await scanTargetList<Repo>({
  category: CategoryRepo.REPO,
  selectFields: "value",           // narrow select when possible
  orderBy: { field: "value", ascending: true },
  maxRows: 500,                    // optional fuse against runaway scans
});
```

- Internally: fixed batch size `MAX_TARGET_LIST_PAGE_SIZE` (100) per round-trip; results merged before return.
- **No public `pageSize`** — callers ask for full scan; batching is an implementation detail.
- Failures throw via `handleSupabaseError` (same as `getTargetList`).
- **Do not** reimplement this loop in `repo.api.ts`, `task.api.ts`, etc.

### Offset scan tradeoffs

| Scenario | Verdict |
|----------|---------|
| Small catalog (Repo registry, startup read) | ✅ Fine |
| Large table + concurrent inserts/deletes during scan | ⚠️ Possible skip/duplicate — consider keyset or DB RPC later |
| Need only one column (`value`) at scale | Consider Postgres RPC `SELECT DISTINCT value …` (SDK interface can stay) |

Evolve pagination inside `scanTargetList` only — feature callers unchanged.

---

## Feature-layer pattern: domain mapping

Core returns rows; feature returns domain values.

```typescript
// repo.api.ts — getScanRemoteRepoValues (Zod + SupabaseResponse, no throw)
const { data, error } = await getScanRemoteRepoValues({ usage: TASK_REPO_USAGE });
if (error) { /* handle */ }
```

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| `while` + repeated `getTargetList` in feature files | `scanTargetList` |
| Using `getTargetList` with guessed huge `limit` | `scanTargetList` or `getTargetTotalCount` first |
| Duplicating `buildCategoryScopedQuery` + range logic | Extend core API |
| `pollTargetList` for read-only bootstrap | `scanTargetList` (poll deletes rows) |
| `getPossibleTarget` when duplicates may exist | `getTargetList` + `limit: 1` + `orderBy` |

---

## Related skills

- [create-target-redundancy](../create-target-redundancy/SKILL.md) — `maybeSingle` / duplicates on create path; UNIQUE / RPC future
- [task-local-discovery](../task-local-discovery/SKILL.md) — `registerTasks` uses `getScanRemoteRepoValues` → `scanTargetList`
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — list/scan APIs throw; callers catch at app boundary

## Implementation map

| Concern | File |
|---------|------|
| Query primitives (`getPossibleTarget`, list/scan) | `src/core.api.ts` |
| Repo value discovery | `src/repo/repo.api.ts` (`getScanRemoteRepoValues`) |
