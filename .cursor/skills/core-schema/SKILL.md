---
name: core-schema
description: >-
  Scope and conventions for `core.schema.ts` in target-supabase-sdk: cross-cutting Zod
  schemas (QueryFilter, PostTargetPayload, TargetDraft), formatZodError,
  safeParseWithSchema. Use when adding shared runtime validation, replacing BaseValidator,
  message-boundary parse, or deciding core.schema vs domain *.api.ts schemas.
---

# Core schema (`core.schema.ts`)

## One-line rule

**`core.schema.ts` = cross-domain Zod schemas and safe-parse helpers reused by `core.api.ts`, extension message boundaries, and any caller that needs shared Target/QueryFilter shape checks — not domain-specific `post*` payloads.**

---

## Scope (what belongs here)

| Belongs in `core.schema.ts` | Belongs elsewhere |
|-----------------------------|-------------------|
| Shapes tied to **`Target` / `TargetDraft` / `QueryFilter`** (core row model) | Domain `postTaskSchema`, `postListCreate` payloads in `*.api.ts` |
| Schemas used by **`core.api.ts`** (`postTarget`, `patchTarget`, `createTarget` filters) | `link.build.ts` input schemas (`linkTargetDraftBuildInputSchema`) |
| **`safeParseWithSchema`** / **`formatZodError`** for non-throwing parse | `validateWithSchema` wrappers in feature `*.api.ts` (throw → envelope) |
| Extension / bridge message validation of **generic Target draft** | Extension-only allowlists, message `type` constants |

```text
core.interface.ts   TypeScript models (Target, QueryFilter, TargetDraft<T>)
core.schema.ts      Zod runtime validation for those cross-cutting shapes
core.api.ts         Supabase I/O; imports schemas; may throw on invalid input
<domain>/*.api.ts   Domain Zod + validateWithSchema + SupabaseResponse envelope
<domain>/*.build.ts Pure draft assembly (may own small local schemas)
```

Exported via `browser.ts` → `export * from "./core.schema"` (browser-safe).

---

## Current exports

| Symbol | Role |
|--------|------|
| `queryFilterSchema` | `QueryFilter` — `createTarget` redundancy, optimistic locks, message payloads |
| `postTargetPayloadSchema` | `PostTargetPayload` — `postTarget` / `patchTarget` body (looser strings) |
| `targetDraftSchema` | `TargetDraft` boundary — trim + min(1) on `name` / `value` / `category` |
| `formatZodError` | Single-line `"; "`-joined issue messages |
| `safeParseWithSchema` | `{ ok, data } \| { ok: false, error }` — no throw |

### Strictness layers (do not collapse)

```typescript
postTargetPayloadSchema   // API compat: z.string() on identity fields (empty string allowed)
targetDraftSchema         // draft/message boundary: .trim().min(1)
```

- **`postTargetPayloadSchema`** replaces legacy `PostTargetPayloadValidator` (`BaseValidator`). Keep field set aligned with `PostTargetPayload` type.
- **`targetDraftSchema`** extends payload schema for **untrusted input** (extension `postTarget` message, external JSON). Stricter normalize only here.

Domain link sugar uses **`linkTargetDraftBuildInputSchema`** in `link.build.ts` — not `core.schema.ts`.

---

## `QueryFilter` and `z.unknown()` pitfall

`QueryFilter` interface lives in **`core.interface.ts`** (with `Target`). Schema lives in **`core.schema.ts`**.

`z.unknown()` / `z.any()` infer **`value?` optional** in Zod 3 output types. Use **`.transform()`** to produce a definite `QueryFilter`:

```typescript
export const queryFilterSchema = z
    .object({
        field: z.string().trim().min(1),
        operator: z.enum(["eq", "neq", "in"]),
        value: z.any(),
    })
    .transform((row): QueryFilter => ({
        field: row.field,
        operator: row.operator,
        value: row.value,
    }));
```

Do not `satisfies z.ZodType<QueryFilter>` on a raw object schema if output still marks `value` optional.

---

## Two validation styles

| Style | When | API |
|-------|------|-----|
| **Throw** | `core.api.ts`, `validateWithSchema` feature APIs | `schema.parse()` / `validateWithSchema` → `formatZodValidationError` (multi-line, schema name) |
| **Safe result** | Message handlers, `{ ok, error }` UI helpers | `safeParseWithSchema(schema, input)` → `formatZodError` |

```typescript
// core.api.ts — throw (existing pattern)
function parsePostTargetPayload(payload: unknown): PostTargetPayload {
    const result = postTargetPayloadSchema.safeParse(payload);
    if (!result.success) {
        throw formatZodValidationError("PostTargetPayload", result.error);
    }
    return result.data;
}

// extension / bridge — safe
const parsed = safeParseWithSchema(postTargetMessagePayloadSchema, raw);
```

Do **not** replace `validateWithSchema` in feature `*.api.ts` with `safeParseWithSchema` unless the caller expects a result object — feature APIs must still map failures to `generateResponse.error` ([sdk-error-handling](../sdk-error-handling/SKILL.md)).

---

## Adding a new schema (checklist)

1. **Cross-domain?** Used by `core.api.ts` or multiple domains / extension bridges → `core.schema.ts`. Single domain only → colocate in `src/<domain>/*.api.ts` or `*.build.ts`.
2. **Type first** — add or reuse interface in `core.interface.ts` (or domain `*.interface.ts`). Export `z.infer<typeof fooSchema>` when the schema is the source of truth.
3. **Name** — `fooSchema` (runtime), `Foo` or `type Foo = z.infer<typeof fooSchema>` (type).
4. **Strictness** — document if a stricter variant is needed (like `targetDraftSchema` vs `postTargetPayloadSchema`). Extend with `.extend({ field: stricter })`, do not duplicate whole objects.
5. **Export** — add to `core.schema.ts` only; `browser.ts` already re-exports. `core.api.ts` may re-export types for backward compat (`export type { PostTargetPayload } from "./core.schema"`).
6. **No Supabase** — `core.schema.ts` must not import `supabase`, `core.api.ts` I/O, or domain managers.
7. **`pnpm build`** — verify symbols in `dist/browser.d.ts`.

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| Domain `postTaskSchema` in `core.schema.ts` | `task-post.api.ts` |
| `linkTargetDraftBuildInputSchema` in `core.schema.ts` | `link.build.ts` |
| Duplicate `QueryFilter` interface in schema file | `core.interface.ts` + import type |
| `safeParseWithSchema` inside `*.api.ts` public export without envelope | `validateWithSchema` + try/catch → `generateResponse.error` |
| Reintroduce `PostTargetPayloadValidator` / `BaseValidator` for Target row | `postTargetPayloadSchema` |
| One mega-schema for API + message + domain | Layered: payload → draft → domain |

---

## Consumers (reference)

| Consumer | Uses |
|----------|------|
| `core.api.ts` `postTarget` / `patchTarget` | `postTargetPayloadSchema` |
| `core.api.ts` `createTarget` filters | `QueryFilter` type (validated at call sites or via `queryFilterSchema`) |
| `chrome-extension-starter` `post-target.ts` | `targetDraftSchema`, `queryFilterSchema`, `safeParseWithSchema` |
| `chrome-extension-starter` `build-list-target-draft.ts` | `formatZodError` |

Extension composes **local** schemas on top of SDK exports:

```typescript
const postTargetMessagePayloadSchema = z.object({
    target: targetDraftSchema,
    checkRedundancyFilterList: z.array(queryFilterSchema).optional(),
});
```

Message `type` constants and handler routing stay in the extension — not in `core.schema.ts`.

---

## Related skills

- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `validateWithSchema` vs envelope; core throws
- [target-draft-build](../target-draft-build/SKILL.md) — `*.build.ts` vs schema validation
- [library-exports](../library-exports/SKILL.md) — public surface / barrels
- [field-definition](../field-definition/SKILL.md) — service introspection schemas (separate from Zod runtime)

## Reference files

| File | Role |
|------|------|
| `src/core.schema.ts` | Cross-cutting Zod schemas + safe parse helpers |
| `src/core.interface.ts` | `Target`, `QueryFilter`, `TargetDraft<T>` |
| `src/core.api.ts` | Imports schemas; `parsePostTargetPayload`; re-exports |
| `src/browser.ts` | `export * from "./core.schema"` |
