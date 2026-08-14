---
name: target-draft-build
description: >-
  Meaning and conventions of `*.build.ts` in target-supabase-sdk: pure TargetDraft
  assembly (no Supabase I/O), build input types, manifestVersion, link vs list
  builders, module-private intermediate types. Use when adding or reviewing
  link.build.ts, list.build.ts, buildLinkTargetDraft, buildListTargetDraft,
  LinkTargetDraftBuildInput, or migrating draft builders from chrome-extension-starter.
---

# Target draft build (`*.build.ts`)

## One-line rule

**`*.build.ts` = pure, synchronous helpers that assemble in-memory `TargetDraft<T>` rows from caller-friendly inputs — no Supabase, no Zod HTTP validation, no persistence.**

Not to be confused with Rollup/tsc **build tooling** ([rollup-library-build](../rollup-library-build/SKILL.md)).

---

## Layer map

```text
*.interface.ts     Persisted Target shape (Link, List, LinkDetails, ListDetails)
*.build.ts         TargetDraft assembly — convenience inputs → draft rows
*.api.ts           HTTP/RPC: Zod payload → createTarget / post* → DB
*-manager.ts       Domain logic that may return TargetDraft (e.g. ParcelManager.save)
```

| File | Runs I/O? | Validates HTTP? | Output |
|------|-----------|-----------------|--------|
| `link.build.ts` | No | No | `TargetDraft<Link>` |
| `list.build.ts` | No | No | `TargetDraft<List>` |
| `link.api.ts` | Yes | Yes (`PostLinkValidator`) | persisted `Link` |
| `list.api.ts` | Yes | Yes | persisted `List` |

`TargetDraft<T> = Omit<T, "id" | "created_at">` — see [manager-api-service § TargetDraft](../manager-api-service/SKILL.md#targetdraft).

Typical consumer flow:

```text
page extract → *.build.ts (draft) → postTarget / postListCreate (api) → DB row
```

Extension projects may keep a thin wrapper (e.g. zod `*Result` helpers) **outside** the SDK; the draft shape itself belongs in `*.build.ts`.

---

## Current modules

| File | Builder | Build input type | Notes |
|------|---------|------------------|-------|
| `src/link/link.build.ts` | `buildLinkTargetDraft` | `LinkTargetDraftBuildInput<O>` | Sets `category`, `tagList`, `details.manifestVersion` |
| `src/list/list.build.ts` | `buildListTargetDraft` | `BuildListTargetDraftInput` | Maps items → link drafts; nests them in `List.details.items` |

Both export `*_MANIFEST_VERSION` (currently `0`) written into `details.manifestVersion`.

---

## `link.build.ts`

**Purpose:** turn a flat, caller-friendly link description into one `TargetDraft<Link>`.

```typescript
export interface LinkTargetDraftBuildInput<O = unknown> {
    name: string;
    value: string;          // URL
    description: string;
    preview?: string;
    loaderKey: string;
    tagList?: string[];     // defaults to [] when omitted
    original: O;            // page-specific payload in details.original
}

buildLinkTargetDraft(input) → TargetDraft<Link>
```

**Input omits `category`** — builder always sets `CategoryLink.LINK`.

**Do not** add `LinkDraft` / `LinkDraftWithOriginal` to `link.interface.ts`. Those were list-build intermediates only; `link.interface.ts` stays the persisted model.

---

## `list.build.ts`

**Purpose:** assemble a `TargetDraft<List>` whose `details.items` hold list entries.

### Items: Link-first, custom allowed

**Most lists store Link rows** — each item becomes a `TargetDraft<Link>` nested in `List.details.items`.

For convenience, callers may pass **`LinkTargetDraftBuildInput`** instead of a full link draft. That is **syntactic sugar**: `buildListTargetDraft` detects the shape (Zod) and calls `buildLinkTargetDraft` before persisting.

Any other value is stored **as-is** (e.g. log `LogEntry[]`, opaque records) — not required to be Link-related.

`BuildListTargetDraftInput` requires **`name`** and **`value`** (Target row columns). Defaulting `name` to `loaderKey` is the **caller's** responsibility — `buildListTargetDraft` does not infer it.

```typescript
export type BuildListTargetDraftInput<O = unknown, TCustom = unknown> = {
    loaderKey: string;
    name: string;
    value: string;
    meta?: unknown;
    preview?: string;
    tagList?: string[];
    items: Array<LinkTargetDraftBuildInput<O> | TCustom>; // Link sugar | custom as-is
};
```

Single `buildListTargetDraft(input)` — no overloads.

| Item at runtime | Behavior |
|-----------------|----------|
| Matches `linkTargetDraftBuildInputSchema` | `buildLinkTargetDraft(item)` → Link draft in `items` |
| Anything else | Stored in `details.items` unchanged |

Schema: `linkTargetDraftBuildInputSchema` in `link.build.ts` (`.strict()` — extra keys such as `category` fail the check, so pre-built link drafts and custom shapes stay distinct when callers include `category`).

### Item handling

Custom items in `items` are **not** required to be `TargetDraft<Link>`. `ListDetails.items` stays `Array<unknown>` in `list.interface.ts` — do **not** genericize `ListDetails<TItem>` (breaks log list using `items` for `LogEntry[]`).

---

## Naming conventions

| Symbol | Pattern | Example |
|--------|---------|---------|
| Build input | `*TargetDraftBuildInput` or `Build*TargetDraftInput` | `LinkTargetDraftBuildInput`, `BuildListTargetDraftInput` |
| Builder fn | `build*TargetDraft` | `buildLinkTargetDraft`, `buildListTargetDraft` |
| Manifest const | `*_MANIFEST_VERSION` | `LINK_MANIFEST_VERSION`, `LIST_MANIFEST_VERSION` |

Avoid exporting per-domain `*Draft` aliases from `*.interface.ts` when `TargetDraft<T>` is enough ([manager-api-service](../manager-api-service/SKILL.md#targetdraft)).

---

## Public exports

Listed explicitly in domain barrels ([library-exports](../library-exports/SKILL.md)):

**`src/link/index.ts`**

```typescript
export { buildLinkTargetDraft, linkTargetDraftBuildInputSchema, LINK_MANIFEST_VERSION } from "./link.build";
export type { LinkTargetDraftBuildInput } from "./link.build";
```

**`src/list/index.ts`**

```typescript
export { buildListTargetDraft, LIST_MANIFEST_VERSION } from "./list.build";
export type { BuildListTargetDraftInput } from "./list.build";
```

`LinkDraft` is **not** exported (no intermediate draft alias in `list.build.ts`).

---

## Extension consumer pattern (chrome-extension-starter)

SDK owns draft assembly; extension may keep:

- Re-exports from `target-supabase-sdk` for stable import paths.
- Zod `{ ok, error }` wrappers (e.g. `buildListTargetDraftResult`) that call `buildListTargetDraft` after schema parse.

```typescript
// extension — OK to keep here
export function buildListTargetDraftResult<T>(
    schema: ZodType<T>,
    input: unknown,
    build: (validInput: T) => BuildListTargetDraftInput,
): ListTargetDraftResult { /* zod + buildListTargetDraft */ }
```

While SDK is unpublished, extension can use `"target-supabase-sdk": "file:../supabase-sdk"` — rebuild SDK then `pnpm install` in extension.

---

## When to add a new `*.build.ts`

Add `*.build.ts` when:

- Multiple callers need the same **TargetDraft shape** assembly.
- Logic is pure mapping (defaults, `manifestVersion`, nested `details`).
- You want browser-safe reuse without pulling in `*.api.ts` / Supabase.

**Do not** put in `*.build.ts`:

- `createTarget` / `post*` calls
- Zod schemas for HTTP payloads (belongs in `*.api.ts`)
- File I/O, adapters, or Manager orchestration

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| `LinkDraft` on `link.interface.ts` | `TargetDraft<Link>` only when building links |
| Treat custom list items as pre-built `TargetDraft<Link>` | Custom items are arbitrary — pass through as-is |
| `ListDetails<TItem>` generic | Keep `items: Array<unknown>` |
| `buildLinkTargetDraft` requiring `category` in input | Builder sets `category` |
| Duplicating draft assembly in every page `*-list.build.ts` | Call SDK `buildListTargetDraft` / `buildLinkTargetDraft` |
| Importing `list.build.ts` from `link.build.ts` | `list` depends on `link`, not reverse (no cycle) |

---

## Checklist (new or changed builder)

- [ ] File named `src/<domain>/<domain>.build.ts` (or sub-resource, e.g. `link.build.ts` under link domain)
- [ ] Returns `TargetDraft<T>`; sets `category`, `tagList` defaults, `details.manifestVersion`
- [ ] Build input type exported; intermediate draft aliases stay module-private unless cross-domain need is proven
- [ ] Symbols added to `src/<domain>/index.ts` explicit list
- [ ] `pnpm build` — symbols appear in `dist/browser.d.ts`
- [ ] No Supabase / `createTarget` imports in `*.build.ts`
- [ ] `ListDetails` / other shared interfaces unchanged unless explicitly requested

---

## Related skills

- [library-exports](../library-exports/SKILL.md) — barrel export of build symbols
- [manager-api-service](../manager-api-service/SKILL.md) — TargetDraft vs API payload vs Manager
- [create-target-redundancy](../create-target-redundancy/SKILL.md) — persistence after draft is posted
- [browser-node-exports](../browser-node-exports/SKILL.md) — `*.build.ts` is browser-safe; export via `browser.ts`

## Reference files

| File | Role |
|------|------|
| `src/link/link.build.ts` | Single-link draft builder |
| `src/list/list.build.ts` | List draft builder + private `LinkDraft` |
| `src/link/link.interface.ts` | Persisted `Link` model only |
| `src/list/list.interface.ts` | Persisted `List` model; `items: Array<unknown>` |
| `src/core.interface.ts` | `TargetDraft<T>` definition |
