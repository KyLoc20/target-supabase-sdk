---
name: target-list-query
description: >-
  Target table query layering in target-supabase-sdk core.api: getTargetList (single page),
  scanTargetList (full scan), getTargetTotalCount, pollTargetList. Use when implementing
  or reviewing list/fetch-all/pagination loops, repo discovery, bootstrap scans, or
  deciding whether feature code should call getTargetList vs scanTargetList.
---

# Target list query layering (target-supabase-sdk)

## Core rule

**Feature APIs must not hand-roll `while (pageNum++)` pagination.** Put full-scan loops in core; feature layers map rows to domain shapes.

PostgREST / Supabase enforces a server **max-rows** cap per request — “fetch all in one query” is usually impossible. Pagination is required; **where** it lives matters.

---

## API matrix (`src/core.api.ts`)

| API | Semantics | When to use |
|-----|-----------|-------------|
| `getTargetList` | **Single page** — explicit `pageNum` + `pageSize` (or `limit`) | UI lists, caller-controlled pagination |
| `scanTargetList` | **Full scan** — auto-pages until exhausted | Worker bootstrap, sync jobs, registry discovery |
| `getTargetTotalCount` | Count only (`head: true`) | UI totals, pre-check size |
| `pollTargetList` | **Dequeue** — SELECT batch + DELETE each row | Command queue, at-most-once consumers |

All use `buildCategoryScopedQuery` → always scope by `category` + optional `filterList`.

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

---

## Related skills

- [task-local-discovery](../task-local-discovery/SKILL.md) — `registerTasks` uses `getScanRemoteRepoValues` → `scanTargetList`
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — list/scan APIs throw; callers catch at app boundary

## Implementation map

| Concern | File |
|---------|------|
| Query primitives | `src/core.api.ts` |
| Repo value discovery | `src/repo/repo.api.ts` (`getScanRemoteRepoValues`) |
