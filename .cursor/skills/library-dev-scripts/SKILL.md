---
name: library-dev-scripts
description: >-
  Dev-only scripts/ layout for target-supabase-sdk: tsx runner, tsconfig.scripts.json,
  separate typecheck from library src, NodeManager worker entry. Use when adding or
  reviewing scripts/, package.json worker/typecheck:scripts, tsx, or why scripts must
  not be in the main tsconfig include for a publishable library.
---

# Library dev scripts (target-supabase-sdk)

## Rule

**`scripts/` is repo-local dev tooling — not part of the published package.**

| Layer | Path | Typecheck | Build | Publish (`files`) |
|-------|------|-----------|-------|-------------------|
| Library | `src/` | `pnpm typecheck` | `tsconfig.build.json` → `dist/` | ✅ `dist`, `src` |
| Dev scripts | `scripts/` | `pnpm typecheck:scripts` | ❌ (not compiled to dist) | ❌ |

Do **not** add `scripts` to the main `tsconfig.json` `include`. A library's root tsconfig defines the **package contract**, not local runner entrypoints.

---

## What is `tsx`?

**`tsx`** is an npm CLI (devDependency) that **runs TypeScript files directly in Node** without a prior `tsc` build.

```json
"worker": "tsx scripts/run-node-worker.ts"
```

| Aspect | Detail |
|--------|--------|
| Role | Runtime TS loader (typically backed by esbuild) |
| Use here | Bootstrap `NodeManager` from `scripts/run-node-worker.ts` |
| Scope | `devDependencies` only — never shipped in `dist` |
| Imports | Scripts may `import "../src/..."` to run against source during dev |

### Alternatives (when not to use tsx)

| Approach | When |
|----------|------|
| **`tsc` + `node dist/...`** | Consumer app or when scripts must match production build artifacts |
| **`ts-node`** | Legacy; prefer `tsx` for new scripts |
| **Node `--experimental-strip-types`** | Possible on newer Node; less portable than `tsx` today |

Default for this repo's `scripts/`: **tsx**.

---

## File layout

```text
scripts/
  load-env.ts           ← read .env.local / .env (no override of existing process.env)
  run-node-worker.ts    ← supabase.initialize() → new NodeManager().start()
  run-trigger-node.ts   ← register TriggerManager runners → new TriggerNode().start()
tsconfig.scripts.json   ← extends root tsconfig; include scripts only
```

**`run-trigger-node.ts` responsibilities:**

1. `initSupabaseFromEnv(projectRoot)` — same env as task worker
2. `TriggerManager.registerRunner({ key, intervalMs, fn })` — code-only registration (see [trigger-local-runners](../trigger-local-runners/SKILL.md))
3. `await new TriggerNode().start()` — 60s loop, parallel due runners

**`run-node-worker.ts` responsibilities:**

1. `loadEnvFiles(projectRoot)` — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `SUPABASE_NEED_AUTH_*`
2. `supabase.initialize({ ... })` via `scripts/init-supabase.ts` (see [supabase-holder](../supabase-holder/SKILL.md))
3. `await new NodeManager().start()` — blocks on main loop; exit via `shutdown` / signals

Local tasks: `config/task.config.js` → `taskDir` (see [task-local-discovery](../task-local-discovery/SKILL.md)).

---

## Typecheck split

### `tsconfig.scripts.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["scripts/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- Inherits `strict`, module settings from library tsconfig
- Entry: `scripts/**/*.ts` only; TypeScript **follows imports** into `src/` for types but does not treat `src` as this project's publish surface
- `noEmit: true` — scripts are executed by `tsx`, not emitted to `dist`

### `package.json` scripts

```json
"typecheck": "tsc -p tsconfig.json --noEmit",
"typecheck:scripts": "tsc -p tsconfig.scripts.json",
"worker": "tsx scripts/run-node-worker.ts"
```

CI runs both steps separately (library, then scripts).

---

## Checklist when adding dev scripts

- [ ] Script lives under `scripts/`, not `src/`
- [ ] Main `tsconfig.json` `include` stays `["src"]` only
- [ ] New script covered by `tsconfig.scripts.json` include glob
- [ ] `pnpm typecheck:scripts` passes
- [ ] Runner uses `tsx` (or document why `tsc`+`node` is required)
- [ ] `tsx` remains in `devDependencies`, not `dependencies`
- [ ] `files` in `package.json` unchanged (`dist`, `src` only)
- [ ] Library exports (`src/index.ts`) expose runtime APIs (`NodeManager`, etc.); scripts are not exported as package entrypoints

---

## Do not

- Add `scripts` to root `tsconfig.json` `include` for a publishable library
- Add `scripts/` to `package.json` `files` or `exports`
- Compile `scripts/` via `tsconfig.build.json` into `dist/`
- Put `tsx` in `dependencies` (consumers of the SDK should not inherit it)
- Use `scripts/` inside `.cursor/skills/*/scripts/` naming — skill utility scripts are unrelated to repo `scripts/` worker layout

---

## Reference (this repo)

| File | Purpose |
|------|---------|
| `scripts/run-node-worker.ts` | Worker entry |
| `scripts/load-env.ts` | Env bootstrap |
| `tsconfig.scripts.json` | Scripts-only typecheck |
| `package.json` | `worker`, `typecheck:scripts` |
| `.github/workflows/ci.yml` | Separate typecheck steps |
| `src/index.ts` | `NodeManager` export for apps; worker script imports `src` directly in dev |
