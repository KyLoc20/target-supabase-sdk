---
name: browser-node-exports
description: >-
  Dual package entry for target-supabase-sdk: browser-safe default (.) vs Node
  runtime (/node). Use when adding public exports, webpack/browser bundling fails
  on node:fs or node:crypto, Chrome extensions import the SDK, or deciding whether
  a symbol belongs in src/browser.ts vs src/node.ts.
---

# Browser / Node dual entry (target-supabase-sdk)

## One-line rule

**Default entry = browser only. Node-only symbols → `src/node.ts` + `target-supabase-sdk/node`. Never statically import `RepoManager`, `TaskManager`, `local-task-registry`, or `repo.script-loader` from browser graph.**

---

## Package exports (`package.json`)

| Entry | File | Use |
|-------|------|-----|
| `target-supabase-sdk` | `dist/browser.js` | Chrome extension, React, Vite, popup |
| `target-supabase-sdk/node` | `dist/node.js` | workers, CLI, TaskNode, RepoManager |
| `target-supabase-sdk/browser` | `dist/browser.js` | explicit alias |

`src/index.ts` re-exports `./browser` (legacy compat).

Version **0.2.0+** — importing `TaskManager` from `.` is a breaking change; use `/node`.

---

## File roles

```text
src/browser.ts   — curated browser-safe re-exports
src/node.ts      — export * from "./browser" + Node-only symbols
src/index.ts     — export * from "./browser"
```

### Browser entry includes

- `supabase`, `core.*`, `auth`, `link`, `list`, domain APIs
- `task.interface`, `task.api` **patch\*** functions, **`postTask`** (enqueue only, no Repo validation)
- `node.interface`, `node.api` (Supabase RPC — no TaskNode class)
- `repo.interface`, `repo.api` (not `RepoManager`)

### Node entry adds

- `TaskManager`, `RepoManager`
- `postTaskWithValidation`, `TaskRepoValidation`
- `TaskNode`, `TriggerNode`, `TriggerManager`, `BaseNodeRuntime`
- `command.*`, `trigger.*` (API); runner scheduling → [trigger-local-runners](../trigger-local-runners/SKILL.md)

---

## Adding a new module (decision workflow)

Every new domain, API, or Manager must be classified **before** registering it on a public entry. `pnpm build` enforces browser safety via `scripts/verify-browser-entry.mjs` — it is not optional manual discipline.

### Mental model

```text
Write code     → classify browser vs node, pick entry file(s)
pnpm build     → verify-browser scans static import graph from dist/browser.js
Consumers      → default entry = browser (incl. postTask); TaskManager / postTaskWithValidation = /node
```

### Step 1 — Scan the module and its static import chain

```bash
rg 'from ["\']node:' src/<domain>/
```

Follow **static** `import` / `export … from` only. Dynamic `import()` inside a function does **not** remove the module from a bundler graph if anything still statically imports that file.

| Finding | Action |
|---------|--------|
| No `node:*` in file or transitive static deps | Safe for browser entry |
| Any `node:fs`, `node:crypto`, `node:path`, … in chain | **Node entry only** |
| Same `.api.ts` mixes browser APIs + Node APIs | **Split files** (see postTask pattern below) |

### Step 2 — Register on the correct entry

| Runtime | Register in | Consumer import |
|---------|-------------|-----------------|
| Browser / bundler | `src/browser.ts` + domain `index.ts` | `from "target-supabase-sdk"` |
| Node worker / CLI | `src/node.ts` only (or split leaf + re-export here) | `from "target-supabase-sdk/node"` |

`src/node.ts` starts with `export * from "./browser"` — symbols on `browser.ts` are automatically on `/node`. Add **only Node-only** symbols explicitly after that line.

Domain barrel (`src/<domain>/index.ts`): list public symbols explicitly. Browser-safe and Node-only symbols may come from **different leaf files** in the same domain (e.g. `task.api.ts` vs `task-post.api.ts`).

### Step 3 — Build and verify

```bash
pnpm build   # rollup (browser.js + node.js) + tsc emitDeclarationOnly + verify-browser-entry.mjs
```

On success:

```text
[verify:browser] OK — dist/browser.js bundle has no node: imports.
```

On failure, the script prints `from "node:…"` matches inside the **browser bundle**. Fix the static import chain or move the symbol to `node.ts` / a Node-only leaf.

Node entry is a Rollup bundle (`dist/node.js`) with peers and `node:*` external — pure `node` can `import "target-supabase-sdk/node"`.

### Common pitfalls

**Dynamic import does not fix a poisoned module**

If `browser.ts` re-exports `./task.api` and `task.api.ts` has a top-level `import` of a Node module, Webpack/Vite still bundle the whole file. Split Node-only exports into a separate leaf (`task-post.api.ts`) and never re-export that leaf from `browser.ts`.

**Types vs implementations**

- Browser: `task.interface`, `task.api` (patch\*), `postTask`, `repo.interface`, `repo.api`
- Node: `TaskManager`, `RepoManager`, `postTaskWithValidation`, `TaskRepoValidation`, `TaskNode`

Interfaces and Supabase RPC helpers can be browser-safe; classes that touch local FS or crypto cannot.

**Internal imports use leaf paths**

Within a domain, import `from "./task.api"` not `from "./index"` — avoids barrel cycles. See [barrel-import-cycles](../barrel-import-cycles/SKILL.md).

**Never statically import from browser graph**

Do not import `task-manager`, `repo-manager`, `local-task-registry`, `repo.script-loader`, `task-post-validated.api`, or `task-repo-validation` from `browser.ts` or any file that `browser.ts` re-exports.

---

## Adding a new public symbol (quick)

1. **Grep** `node:` in the module and its static import graph.
2. **No `node:`** → add to `src/browser.ts`.
3. **Uses `node:fs` / `node:crypto` / …** → add only to `src/node.ts` (or refactor to dynamic `import()` if intentionally callable from browser).
4. Run `pnpm build` — must pass `scripts/verify-browser-entry.mjs`.

---

## postTask pattern (split modules)

**Publish** and **validate-then-publish** are separate leaves so the browser bundle never pulls `TaskRepoValidation` → `RepoManager`.

| Module | Symbols | Entry |
|--------|---------|-------|
| **`task.api.ts`** | `patchClaimTask`, `patchTaskProgress`, … | browser + node |
| **`task-post.api.ts`** | `postTask`, `postTaskSchema`, `PostTaskPayload`, `createTaskRow` | **browser + node** |
| **`task-post-validated.api.ts`** | `postTaskWithValidation` | **node only** |

- **`postTask`** — enqueue only (Zod payload shape); Repo + `taskParamsValidator` run at **`prepareTask`** on the worker.
- **`postTaskWithValidation`** — same insert path via shared `createTaskRow`; runs `TaskRepoValidation.validate({ bootstrapLocal: true })` first (CLI, monolithic schedulers that own `taskDir`).

**Never** statically import `task-post-validated.api.ts` or `task-repo-validation.ts` from `browser.ts` or from modules in the browser graph.

Browser entry:

```typescript
export { postTask, postTaskSchema } from "./task/task-post.api";
export type { PostTaskPayload } from "./task/task-post.api";
```

Node entry adds:

```typescript
export { postTaskWithValidation } from "./task/task-post-validated.api";
```

Internal Node callers: `scripts/post-task.ts` → `postTaskWithValidation`; cross-service schedulers → `postTask` from browser or `/node`.

---

## Consumer examples

**Same Node process may import both entries** (e.g. preload initializes via `/node`, app code uses `.`). That requires the SDK Rollup build to emit **shared chunks** so `supabase` is one module instance — see [rollup-library-build](../rollup-library-build/SKILL.md#dual-entry-singleton-shared-chunk).

```typescript
// Chrome extension popup / background — enqueue without local taskDir
import { supabase, postTask } from "target-supabase-sdk";

// Node worker / preload — init env + Supabase here
import { TaskManager, TaskNode, initSupabaseFromStandardEnv } from "target-supabase-sdk/node";

// Same process can also use browser entry after init
import { getApi } from "target-supabase-sdk";

// CLI post-task script — validate before insert when taskDir is local
import { postTaskWithValidation } from "target-supabase-sdk/node";
```

---

## CI verification

`pnpm build` runs `scripts/verify-browser-entry.mjs`:

- Scans the **bundled** `dist/browser.js` for static `from "node:…"` imports
- Fails if browser artifact pulls Node built-ins

Optional: `scripts/verify-graph.mjs` for multi-file `dist/` layouts (legacy / tooling); **CI gate** is bundle scan only.

Node entry is not separately verified — Rollup + shared-chunk smoke in consumer is the practical check for `/node` + `.` singleton behavior.

---

## Checklist

- [ ] Grep `node:` on new module + full static import chain?
- [ ] Browser-safe → `browser.ts`; Node-only → `node.ts` (or split leaf)?
- [ ] Mixed browser + Node in one file → split (postTask pattern)?
- [ ] Domain `index.ts` updated with explicit exports (not `export *` from manager)?
- [ ] Internal same-domain imports use leaf paths, not domain barrel?
- [ ] `pnpm build` + verify-browser passes?
- [ ] README / consumer docs if new public entry symbol?
- [ ] Node consumers use `/node` for `TaskManager`, `postTaskWithValidation`, `RepoManager`?

---

## Related

- [rollup-library-build](../rollup-library-build/SKILL.md) — Rollup dual entry, **shared chunks / singleton**
- [singleton-pitfalls](../singleton-pitfalls/SKILL.md) — dual-bundle duplicate singleton
- [library-exports](../library-exports/SKILL.md) — domain barrel rules
- [task-local-discovery](../task-local-discovery/SKILL.md) — why local-task-registry stays private
- chrome-extension-starter: `.cursor/skills/target-supabase-sdk-browser-bundle/` — consumer notes (shim optional after SDK 0.2.0)

## Reference files

| File | Role |
|------|------|
| `src/browser.ts` | Browser public surface |
| `src/node.ts` | Node public surface |
| `scripts/verify-graph.mjs` | Static graph walker: `./` + `../`, `dist/`-bounded, resolves `dir/index.js` |
| `scripts/verify-browser-entry.mjs` | Browser entry guard (no `node:*`) |
| `src/task/task.api.ts` | Browser-safe task patch APIs |
| `src/task/task-post.api.ts` | Browser + Node `postTask` (enqueue only) |
| `src/task/task-post-validated.api.ts` | Node-only `postTaskWithValidation` |
