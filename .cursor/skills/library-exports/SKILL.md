---
name: library-exports
description: >-
  Public API and package export conventions for target-supabase-sdk: barrel (index.ts)
  pattern, domain index.ts, root index.ts, package.json exports, named vs export type,
  Manager vs api. Use when adding exports, reviewing index.ts, explaining barrel imports,
  publishing the package, or deciding what to expose to consumers.
---

# Library exports (target-supabase-sdk)

## One-line rule

**Domain `index.ts` lists public symbols explicitly; root `src/index.ts` aggregates with `export * from "./<domain>"`. Named exports only; types via `export type`; internals never re-exported.**

---

## What is a barrel?

**Barrel**（桶文件 / 聚合导出）= 目录下的 **`index.ts`**，把该目录多个 leaf 模块的符号**集中 re-export 到一个入口**。调用方 import 目录路径即可，不必逐个文件路径。

命名来自 metaphor：多个「瓶子」（`*.api.ts`、`*-manager.ts`…）装进一个「桶」（`index.ts`），外部只对接桶口。

### Without barrel

```typescript
import { logManager } from "../shared/log/log-manager";
import { createApiLogger } from "../shared/log/create-api-logger";
import { createRootScope } from "../shared/log/log-scope";
```

### With barrel (`src/shared/log/index.ts`)

```typescript
import { logManager, createApiLogger, createRootScope } from "../shared/log";
```

Barrel 文件只做转发，不含业务逻辑：

```typescript
export { logManager } from "./log-manager";
export { createApiLogger } from "./create-api-logger";
export { createRootScope, withModule, ... } from "./log-scope";
```

| Benefit | Explanation |
|---------|-------------|
| Shorter imports | One path per domain |
| Curated public API | Only listed symbols are public |
| Refactor-friendly | Move/rename leaf files; update barrel only |

**Barrel ≠ `export *` at domain layer.** Domain barrel uses **explicit lists** (see below). Root may use `export * from "./task"` because domain barrel is already curated.

**Internal `src/` code** imports **leaf paths** (`from "./task.api"`, `from "../shared/log/log-manager"`) — not the domain barrel — to avoid cycles. See [barrel-import-cycles](../barrel-import-cycles/SKILL.md). **Exception:** cross-domain callers may use `from "../shared/log"` when importing another domain's public surface.

---

## Two-layer barrel (preferred — `task` & `shared/log` are references)

```text
src/task/task.interface.ts   ─┐
src/task/task.api.ts         ─┼─► src/task/index.ts  (explicit list)
src/task/task-manager.ts     ─┘         │
                                        ▼
                              src/index.ts  →  export * from "./task"
                                        │
                                        ▼
                              package consumer: import { TaskManager } from "target-supabase-sdk"
```

Same pattern for infra domains not yet on root:

```text
src/shared/log/log-manager.ts      ─┐
src/shared/log/log-scope.ts        ─┼─► src/shared/log/index.ts
src/shared/log/create-api-logger.ts ─┘
         ▲
         └── src/*.api.ts imports from "../shared/log" (domain barrel OK cross-folder)
```

| Layer | File | Role |
|-------|------|------|
| **Domain barrel** | `src/<domain>/index.ts` | Single place to curate that domain's public API |
| **Root barrel** | `src/index.ts` | `export * from "./task"` — no per-file paths for migrated domains |
| **Leaf modules** | `*.interface.ts`, `*.api.ts`, `*-manager.ts` | Implementation; internal imports stay direct |

**Internal code** in the **same domain** imports leaf modules (`from "./task.api"`, `from "./log-manager"`) — not `from "./index"` or `from "../task"` barrel. See [barrel-import-cycles](../barrel-import-cycles/SKILL.md).

---

## Domain barrel template (`src/task/index.ts`)

```typescript
/**
 * Task domain public API — curated re-exports only.
 * Internal modules (local-task-registry, task-repo-context, task.utils) stay private.
 */

// enums / runtime values from interface
export { CategoryTask, TaskStatus, TaskStatusAction, ResultCode } from "./task.interface";
export type { Task, TaskDetails, TaskFlow } from "./task.interface";

// api — list every intended public symbol (not export *)
export { patchClaimTask, patchClaimTaskSchema, patchTaskProgress, patchTaskProgressSchema, ... } from "./task.api";
export type { PatchClaimTaskPayload, PatchTaskProgressPayload, ... } from "./task.api";
export { postTask, postTaskSchema } from "./task-post.api";
export type { PostTaskPayload } from "./task-post.api";

// manager — value + caller-facing types only
export { TaskManager } from "./task-manager";
export type { RegisterTasksOptions, RegisterTasksResult, PrepareTaskResponse, ... } from "./task-manager";
```

**Do not** `export * from "./task-manager"` if that file re-exports internal types from `task-repo-context` — cherry-pick in domain `index.ts` instead.

**Keep private** (task example): `local-task-registry.ts`, `task-repo-context.ts`, `task.utils.ts`, `bootstrapLocalTasks`, script loaders.

### Smaller domain example (`src/shared/log/index.ts`)

```typescript
/**
 * Log domain public API — curated re-exports only.
 */

export { logManager, LogManager, LogLevel } from "./log-manager";
export type { LogEntry, LogOptions, LoggerWithScope, LogRestParams } from "./log-manager";

export { createApiLogger } from "./create-api-logger";
export type { CreateApiLoggerOptions } from "./create-api-logger";

export { createRootScope, withModule, ... } from "./log-scope";
export type { LogScope, LogScopePatch } from "./log-scope";
```

Not exported via barrel: nothing else under `shared/log/` today. Consumers inside `src/` use `from "../shared/log"`; files inside `shared/log/` use `from "./log-manager"` etc.

---

## Root barrel (`src/index.ts`)

Migrated domain — one line:

```typescript
export * from "./task";
```

Legacy domains (not yet migrated) may still use inline paths:

```typescript
export * from "./file/file.interface";
export * from "./file/file.api";
export { RepoManager } from "./repo/repo-manager";
```

When adding a new domain or refactoring an existing one, prefer **`src/<domain>/index.ts` + `export * from "./<domain>"`** at root.

Root barrel: **no business logic** (except `supabase` singleton in `browser.ts`).

Since **0.2.0**, default entry is `src/browser.ts` (browser-safe). Node-only exports live in `src/node.ts` → `target-supabase-sdk/node`.

**New module?** Grep static deps for `node:*`, register on `browser.ts` and/or `node.ts`, run `pnpm build` (verify-browser). Full workflow: [browser-node-exports](../browser-node-exports/SKILL.md#adding-a-new-module-decision-workflow).

---

## Entry & packaging (`package.json`)

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
  }
}
```

| Field | Purpose |
|-------|---------|
| `exports["."]` | Single public entry |
| `sideEffects: false` | Tree-shaking friendly |
| `peerDependencies` | Supabase / Zod not bundled |

Optional subpaths (since 0.2.0):

```json
".": "./dist/browser.js",
"./browser": "./dist/browser.js",
"./node": "./dist/node.js"
```

See [browser-node-exports](../browser-node-exports/SKILL.md) for what belongs in each entry.

`scripts/` **never** in any barrel.

---

## What to export (public surface)

| Layer | Export via domain `index.ts`? | Examples |
|-------|-------------------------------|----------|
| `*.interface.ts` | ✅ explicit | `Task`, `TaskStatus` |
| `*.api.ts` | ✅ explicit | `patchClaimTask`, schemas |
| `*-manager.ts` | ✅ curated | `TaskManager` + option/result types |
| Infra | root `index.ts` | `SupabaseInitializer`, `supabase` |
| `*.script-loader.ts`, `*-registry.ts`, `*.utils.ts` | ❌ | unless deliberate extension point |

---

## Named exports & `export type`

**No `export default` in `src/`.**

| Content | Syntax |
|---------|--------|
| Functions, enums, managers, Zod schemas | `export { foo }` |
| Interfaces, type aliases | `export type { Foo }` |

```typescript
import { TaskManager, patchClaimTask, type Task, type RegisterTasksOptions } from "target-supabase-sdk";
```

---

## Why not `export *` at domain barrel?

| `export * from "./task.api"` at domain index | Explicit list in `src/task/index.ts` |
|---------------------------------------------|--------------------------------------|
| New internal export becomes public API | Add symbol deliberately to index |
| Duplicate if two leaf files export same name | One export path per symbol |
| Hard to review diff | Public surface visible in one file |

Root `export * from "./task"` is safe **because** `task/index.ts` is already curated.

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| `export * from "./task-manager"` when it re-exports internals | Cherry-pick in `src/task/index.ts` |
| Leaf module `import from "../index"` | Import sibling leaf paths |
| Export registry / script-loader via domain index | Keep internal |
| Default export only | Named + `export type` |
| Duplicate task exports in root (inline + `export * from "./task"`) | Only domain barrel path |

---

## Checklist (new public symbol)

- [ ] Belongs in public API (not internal helper)?
- [ ] Added to **`src/<domain>/index.ts`** explicit list (enums/values vs `export type`)?
- [ ] Root `src/index.ts` already has `export * from "./<domain>"` (or add domain barrel first)?
- [ ] No duplicate export from two leaf files through same barrel?
- [ ] `pnpm build` — symbol in `dist/index.d.ts`?
- [ ] Internal imports still use leaf paths (no barrel cycle)?

---

## Related skills

- [barrel-import-cycles](../barrel-import-cycles/SKILL.md) — never `import from "."` inside `src/`
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `*.api.ts` envelope
- [task-local-discovery](../task-local-discovery/SKILL.md) — task internals not in public index
- [library-dev-scripts](../library-dev-scripts/SKILL.md) — scripts not published

## Reference files

| File | Role |
|------|------|
| `src/task/index.ts` | **Reference domain barrel** (explicit exports) |
| `src/shared/log/index.ts` | **Reference infra barrel** (log public API) |
| `src/index.ts` | Root aggregate (`export * from "./task"`) |
| `package.json` | `exports`, `types` |
| `dist/index.d.ts` | Verify published surface after `pnpm build` |
