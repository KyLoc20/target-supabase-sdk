---
name: library-exports
description: >-
  Public API and package export conventions for target-supabase-sdk: index.ts barrel,
  package.json exports, named vs default export, export type, Manager vs api vs core,
  subpath exports, and tree-shaking. Use when adding exports, reviewing index.ts,
  publishing the package, or deciding what to expose to consumers.
---

# Library exports (target-supabase-sdk)

## One-line rule

**Single package entry, named exports only, types via `export type`, public surface curated by domain — api + types + managers out; implementation details stay internal.**

---

## Entry & packaging (`package.json`)

Current model (keep unless explicitly expanding):

```json
{
  "type": "module",
  "sideEffects": false,
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "peerDependencies": {
    "@supabase/supabase-js": "^2.50.0",
    "zod": "^3.23.0"
  }
}
```

| Field | Purpose |
|-------|---------|
| `exports["."]` | Single public entry — consumers import from package name only |
| `sideEffects: false` | Tree-shaking friendly |
| `peerDependencies` | Supabase / Zod not bundled into the library |
| `prepack` → `build` | Published tarball contains `dist/` + types |

**Later (optional):** subpath exports e.g. `"./task": "./dist/task/index.js"` when root `index.ts` grows too large — not required yet.

`scripts/` and dev-only code **never** appear in `index.ts`.

---

## Root barrel (`src/index.ts`)

Role: **aggregate domain public APIs** — no business logic.

Preferred layout per domain:

```text
types   → export * from "./task/task.interface"   (or export type { ... })
api     → export * from "./task/task.api"
manager → export { TaskManager } + export type { ... }
```

Avoid duplicate re-exports (e.g. same module exported twice).

---

## What to export (public surface)

| Layer | Export? | Examples |
|-------|---------|----------|
| `*.interface.ts` | ✅ | `Task`, `Repo`, `SupabaseResponse` |
| `*.api.ts` | ✅ | `patchClaimTask`, `getScanRemoteRepoValues` |
| `*-manager.ts` | ✅ (curated) | `TaskManager`, `NodeManager`, `RepoManager` |
| Infra | ✅ | `SupabaseInitializer`, `supabase` singleton |
| Stable helpers | ✅ sparingly | `isOptimisticLockError` |
| `core.api.ts` | ✅ (legacy breadth) | tighten over time |
| `*.script-loader.ts`, internal utils | ❌ | unless deliberate extension point |

Organize by **consumer intent**:

```text
UI / scripts     → api functions + types
Worker runtime   → managers + api + SupabaseInitializer
Advanced / rare  → core helpers (minimize)
```

Document that `supabase` singleton requires `SupabaseInitializer.initialize()` first.

---

## Named exports only (managers & singletons)

**All SDK modules use named exports — no `export default` in `src/`.**

```typescript
// task-manager.ts
export const TaskManager = { registerTasks, prepareTask, ... };

// index.ts
export { TaskManager } from "./task/task-manager";
export type { RegisterTasksOptions, RegisterTasksResult } from "./task/task-manager";
```

Managers: `TaskManager`, `NodeManager`, `RepoManager`, `ParcelManager`, `FileManager`.  
Log singleton: `export const logManager` from `log-manager.ts` (internal; not in root `index.ts`).

Types alongside values: `export type { ... }` from the same module path in `index.ts`.

---

## `export` vs `export type`

| Content | Syntax |
|---------|--------|
| Functions, classes, const enums, managers | `export { foo }` |
| Interfaces, type aliases | `export type { Foo }` |

Benefits: `isolatedModules` / `verbatimModuleSyntax` safe; clear runtime vs type-only boundary.

Callers:

```typescript
import { TaskManager, patchClaimTask, type Task, type RegisterTasksOptions } from "target-supabase-sdk";
```

---

## `export *` — use with care

`export * from "./task/task.api"` re-exports **every** named export in that file as public API.

| Pros | Cons |
|------|------|
| Low boilerplate | Internal rename/add becomes breaking change |
| | Hard to see full public surface from one file |

**Prefer** domain sub-barrels (`src/task/index.ts`) that list exports explicitly, then `export * from "./task"` at root — or cherry-pick like `RegisterTasksOptions` when the module also re-exports internals.

---

## Manager + types pattern (this repo)

```typescript
// task-manager.ts — export runtime object + option/result types used by callers
export interface RegisterTasksOptions { ... }
export interface RegisterTasksResult { ... }
export const TaskManager = { registerTasks, prepareTask, ... };

// index.ts
export { TaskManager } from "./task/task-manager";
export type { RegisterTasksOptions, RegisterTasksResult } from "./task/task-manager";
```

Do not rely on `Parameters<typeof TaskManager.registerTasks>[0]` in consumer docs — export types explicitly.

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| Default export only, no type re-export | `export type { Options }` alongside named value |
| Export script loaders / internal utils | Keep internal; expose via manager/api |
| Duplicate `export *` same module in index | Single re-export path |
| Throwing from `*.api.ts` | Envelope — see [sdk-error-handling](../sdk-error-handling/SKILL.md) |
| Bundling peer deps | Keep in `peerDependencies` |

---

## Checklist (new public symbol)

- [ ] Belongs in public API (not internal helper)?
- [ ] Exported from domain module, then `src/index.ts`?
- [ ] Types use `export type`?
- [ ] Manager uses `export { X }` (no default)?
- [ ] `pnpm build` — types appear in `dist/index.d.ts`?
- [ ] README / changelog if user-facing?

---

## Related skills

- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `*.api.ts` envelope, no throw
- [barrel-import-cycles](../barrel-import-cycles/SKILL.md) — never `import from "."` inside `src/`
- [task-local-discovery](../task-local-discovery/SKILL.md) — `TaskManager`, worker exports
- [library-dev-scripts](../library-dev-scripts/SKILL.md) — `scripts/` not published API

## Reference files

| File | Role |
|------|------|
| `package.json` | `exports`, `types`, `peerDependencies` |
| `src/index.ts` | Root barrel |
| `dist/index.d.ts` | Published type surface (verify after build) |
