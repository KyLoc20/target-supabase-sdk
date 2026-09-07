---
name: postgrest-query-filters
description: >-
  PostgREST filter helpers in target-supabase-sdk: escapeIlikePattern for ilike/or
  searches, toPostgrestTextArrayLiteral for text[] overlaps and not.ov filters.
  Use when filtering Target.tagList or any text[] column via supabase.client, or
  when ilike patterns or array literals break PostgREST query strings.
---

# PostgREST query filters (target-supabase-sdk)

Location: `src/shared/utils/postgrest.utils.ts` — exported from `target-supabase-sdk` (browser + node entries).

---

## `escapeIlikePattern(raw)`

Use before embedding user input in `.ilike()` or `.or("col.ilike.%…%")` filters.

| Character | Why escape |
|-----------|------------|
| `%` `_` `\` | SQL `LIKE` wildcards |
| `,` | Breaks PostgREST `.or()` comma-separated filter list |

```typescript
import { escapeIlikePattern, supabase, CategoryList } from "target-supabase-sdk";

const q = escapeIlikePattern(req.query.q);
const { data } = await supabase.client
  .from("target")
  .select("*")
  .eq("category", CategoryList.LIST)
  .ilike("name", `%${q}%`);
```

Multi-column search (ideas list pattern):

```typescript
query = query.or(`value.ilike.%${escaped}%,name.ilike.%${escaped}%`);
```

**Do not** pass raw user strings into `ilike` without escaping — `%` and `_` widen matches; commas in `.or()` corrupt the filter.

---

## `toPostgrestTextArrayLiteral(values)`

Formats a JS `string[]` as a PostgreSQL `text[]` literal for PostgREST **string** filter overloads.

### `tagList` overlaps (include filter)

```typescript
import { toPostgrestTextArrayLiteral } from "target-supabase-sdk";

query = query.overlaps("tagList", toPostgrestTextArrayLiteral(includeTags));
```

Passing a raw JS array to `.overlaps()` often works (client joins into `{a,b}`), but **values containing `:` must be quoted** — use this helper for consistency.

### `tagList` exclude (`not.ov`)

**Broken** — never use `.not("tagList", "ov", jsArray)`:

```typescript
// BAD: Array#toString() → not.ov.stop-word:base,small-word (invalid PG array)
query.not("tagList", "ov", ["stop-word:base", "small-word"]);
```

**Correct:**

```typescript
query = query.filter("tagList", "not.ov", toPostgrestTextArrayLiteral(excludeTags));
```

### Example literals

| JS array | Literal |
|----------|---------|
| `["verb"]` | `{"verb"}` |
| `["stop-word:base", "small-word"]` | `{"stop-word:base","small-word"}` |

Every element is double-quoted; backslashes and quotes inside values are escaped.

---

## When QueryFilter is not enough

`QueryFilter` in `core.api.ts` has no `ilike`. Services that need fuzzy list search use `supabase.client` directly with `escapeIlikePattern` + optional `toPostgrestTextArrayLiteral` (see upload-service `listEnglishWords`).

For full-table walks prefer `scanTargetList` / serial pagination in core — do not duplicate unbounded `while` loops in feature code when a core API exists.

---

## Related skills

- [target-list-query](../target-list-query/SKILL.md) — `getTargetList` vs `scanTargetList`
- [library-exports](../library-exports/SKILL.md) — export surface for new utils
