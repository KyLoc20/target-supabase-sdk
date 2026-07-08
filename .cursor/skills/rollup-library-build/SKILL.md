---
name: rollup-library-build
description: >-
  Rollup dual-entry build for target-supabase-sdk: browser.js + node.js bundles,
  shared chunks for module singletons, tsc emitDeclarationOnly, peer external,
  verify-browser on bundle output. Use when changing SDK build, choosing Rollup vs
  esbuild/tsc for libraries, fixing "Supabase not initialized" with mixed . and /node
  imports, assessing publish impact, or fixing pure node import of target-supabase-sdk/node.
---

# Rollup library build (target-supabase-sdk)

## One-line rule

**Libraries with browser + node dual entry: Rollup bundle the two public entries; `tsc --emitDeclarationOnly` for types; peers + `node:*` external. Apps (watch-service) stay esbuild — different job.**

---

## Why Rollup (not tsc-only or esbuild) for this SDK

| Approach | Problem for this SDK | Rollup fit |
|----------|----------------------|------------|
| **tsc + `moduleResolution: Bundler`** | `dist/*.js` relative imports lack `.js` → pure `node` cannot `import` | Bundler resolves graph at build time |
| **tsc + `NodeNext`** | Entire `src/` needs `.js` suffixes in imports | Heavy churn |
| **post-build patch `dist`** | Consumer-side or sibling hack; fragile | Avoid |
| **esbuild bundle (SDK)** | Works; less library-ecosystem norm for dual npm entry | OK alternative |
| **Rollup bundle** | Industry default for **publishable library** entries; strong tree-shake inside bundle; clear `external` | **Chosen** |

**esbuild** remains correct for **watch-service** (multi-process app entries, fast CI). Do not merge SDK and app into one tool for aesthetics.

---

## Build pipeline

```text
pnpm clean
  → rollup -c (single build: browser + node entries, shared chunks under dist/chunks/)
  → tsc -p tsconfig.dts.json
  → verify-browser-entry.mjs
```

**Critical:** one Rollup build with **both** entries and `output.dir` + `chunkFileNames`. See [Dual-entry singleton (shared chunk)](#dual-entry-singleton-shared-chunk) — **never** two separate Rollup configs.

| File | Role |
|------|------|
| `rollup.config.js` | `input: { browser, node }`; `output.dir: dist`; `chunkFileNames: chunks/[name]-[hash].js`; peers + `node:*` external |
| `tsconfig.rollup.json` | TS for `@rollup/plugin-typescript` (`noEmit: true`) |
| `tsconfig.dts.json` | `emitDeclarationOnly`, `outDir: dist`, `rootDir: src` |
| `scripts/verify-browser-entry.mjs` | Scan **single** `dist/browser.js` for `from "node:…"` |

### `external` policy

```javascript
function isExternal(id) {
  if (id.startsWith("node:")) return true;
  return peerDependencies.some((name) => id === name || id.startsWith(`${name}/`));
}
```

Peers: `@supabase/supabase-js`, `@supabase/postgrest-js`, `lodash-es`, `zod`.

### Source import style

- Relative imports **without** `.js` suffix in `src/` (Rollup + TS resolve).
- Package consumers still use `target-supabase-sdk` / `target-supabase-sdk/node` only.

---

## Dual-entry singleton (shared chunk)

### Source-level singleton

`supabase` is a **module singleton** in `src/supabase.ts`:

```typescript
export const supabase = SupabaseInitializer.getInstance();
```

One loaded copy of that module → one `initialize()` state for the process. The build must not ship **two copies** of the module when consumers import **both** package entries in the same Node process.

### Failure mode (two separate Rollup builds)

**Anti-pattern** — `rollup.config.js` as an **array** of two independent configs, each with `output.file`:

```text
dist/browser.js  →  bundled supabase module copy A
dist/node.js     →  bundled supabase module copy B
```

Typical consumer (e.g. watch-service main):

```typescript
import { getApi } from "target-supabase-sdk";           // copy A — not initialized
import { initSupabaseFromStandardEnv } from "target-supabase-sdk/node";  // initializes copy B
```

Symptom: `Supabase not initialized. Call initialize() first.` even though `.env` is loaded and `initialize()` ran.

This is **not** a bug in `SupabaseInitializer` logic — it is **duplicate module instances** from duplicate bundles.

### Correct pattern (one build, shared chunk)

**One** `export default` Rollup options object:

```javascript
export default {
  input: {
    browser: resolve(root, "src/browser.ts"),
    node: resolve(root, "src/node.ts"),
  },
  output: {
    dir: resolve(root, "dist"),
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "chunks/[name]-[hash].js",
    sourcemap: true,
  },
  external: isExternal,
  plugins: [/* ... */],
};
```

Rollup places modules imported by **both** entries (including `supabase.ts` and the browser graph) into `dist/chunks/*.js`. Both entries import the same chunk URL:

```text
dist/browser.js  ──┐
                   ├── import from './chunks/….js'  (supabase lives here)
dist/node.js     ──┘
```

### Why one singleton at runtime

Node ESM **module cache**: the first `import` of `./chunks/foo.js` executes the module; later imports of the **same file URL** reuse the same exports. So `supabase.initialize()` via `/node` and `getApi()` via `.` share one holder.

### Checklist when changing Rollup config

- [ ] **Single** `rollup -c` invocation with `input: { browser, node }` — not `export default [ {...}, {...} ]` with separate `output.file`
- [ ] `output.dir` + `chunkFileNames` — not two standalone `output.file` builds
- [ ] After `pnpm build`, open `dist/browser.js` and `dist/node.js` — both should `import`/`export` from the same `./chunks/…` path for `supabase`
- [ ] Smoke test in one process: `initSupabaseFromStandardEnv` from `/node` then `getApi` from `.` must not throw
- [ ] Publish `dist/chunks/` in npm `"files"` (included via `dist` glob)

### Consumer note

Apps that mix both entries in one process (preload on `/node`, API on `.`) **require** this shared-chunk layout. Documented entries only; do not deep-import `dist/chunks/` paths.

See also [singleton-pitfalls](../singleton-pitfalls/SKILL.md#problem-5-dual-entry-rollup-bundles-duplicate-module-singletons-build).

### Unchanged (safe)

| Area | Notes |
|------|-------|
| **Public exports** | `package.json` `"."`, `"./browser"`, `"./node"` → same paths |
| **Source API** | `src/browser.ts`, `src/node.ts` curation unchanged |
| **Types for consumers** | `dist/browser.d.ts`, `dist/node.d.ts` + domain `.d.ts` tree from `tsc` |
| **SDK dev scripts** | `pnpm worker`, `post-task`, etc. — `tsx` + `../src/...` unchanged |
| **peerDependencies** | Still not bundled; app must install peers |
| **verify intent** | Browser bundle must not contain `node:` static imports |
| **watch-service** | `import "target-supabase-sdk/node"` + esbuild `packages: "external"` |

### Improved

| Area | Before | After |
|------|--------|-------|
| **Pure `node` runtime** | `ERR_MODULE_NOT_FOUND` on `dist/node.js` → `./browser` | `import "target-supabase-sdk/node"` works (preload, CLI, spawned workers) |
| **Registry / `file:` install** | Same broken `dist` | Same bundles from `node_modules` |
| **Consumer patching SDK dist** | Needed alias-to-`src` or fix-esm hacks | Not required |

### Behavior changes (know these)

| Area | Impact | Mitigation |
|------|--------|------------|
| **Vite / Webpack tree-shake of SDK** | Default entry is one **pre-bundled** `browser.js` — consumer cannot drop unused SDK exports from our source files | Acceptable for extension + typical apps; future: `preserveModules` or second export if size matters |
| **Deep import of `dist/**/*.js`** | Leaf `.js` under `dist/task/` etc. **no longer emitted** (only `.d.ts` from `tsc`) | **Unsupported** — use documented entries only; never rely on `dist/task/...js` |
| **Deep import of `src/`** | Still in `"files"` for types/debug; not a semver public API | Document "entries only" |
| **`sideEffects: false`** | Still set; semantics differ when consumer receives one bundle | Monitor extension bundle size |
| **CI verify** | `verify-graph.mjs` graph walk on multi-file `dist/` **replaced** by bundle regex scan | Keep `verify-graph.mjs` for optional tooling; CI uses `verify-browser-entry.mjs` only |
| **Build time** | Rollup slower than `tsc` alone | Acceptable for library publish cadence |
| **`pnpm dev` in SDK** | `rollup -c --watch` (not `tsc --watch`) | Rebuild bundles on change |

### Not a regression

- **Double bundling** (Vite imports our `browser.js` then bundles again): normal for pre-built library entries.
- **Node bundle includes browser API**: by design (`node.ts` re-exports browser); Rollup inlines one graph.

---

## Lessons (migration checklist)

1. **Dual entry = one Rollup build + shared chunks** — never two `output.file` builds; see [Dual-entry singleton](#dual-entry-singleton-shared-chunk).
2. **Distinguish app build vs library build** — watch-service: esbuild multi-entry; SDK: Rollup dual entry.
3. **Do not patch sibling `dist`** — fix publish shape in the library repo.
4. **`tsc` alone is not a Node ESM publish strategy** when using `moduleResolution: Bundler`.
5. **Types and JS decouple** — `emitDeclarationOnly` + Rollup JS is standard.
6. **Verify against shipped artifact** — scan `dist/browser.js` bundle, not hypothetical graph.
7. **Preload / `--import` hooks** — need runnable `dist/node.js` with shared singleton.
8. **Strip `.js` from `src/`** — OK with Rollup; use UTF-8 safe edits (avoid PowerShell `Set-Content` without `-Encoding utf8` on CJK strings).
9. **`tslib`** — required by `@rollup/plugin-typescript` unless configured otherwise.
10. **`rollup.config.js` root** — `dirname(fileURLToPath(import.meta.url))`, not `..`.

---

## Consumer guidance

```typescript
// Browser / Vite / extension
import { supabase, createLogger } from "target-supabase-sdk";

// Node service, preload, TaskNode
import { TaskNode, loadEnvFiles } from "target-supabase-sdk/node";
```

**watch-service** after SDK bundles:

- `scripts/build.mjs`: `packages: "external"` (no SDK `src` alias).
- `scripts/preload-env.mjs`: `import from "target-supabase-sdk/node"`.
- `ensure-sdk-built.mjs`: only for `file:` dep; checks `dist/browser.js` + `dist/node.js` mtimes.

---

## When to extend

| Need | Action |
|------|--------|
| Smaller browser install for Vite | Second export with `preserveModules` (future) |
| Stricter source-level CI | Add dependency-cruiser on `src/browser.ts` ([browser-bundle-verification](../browser-bundle-verification/SKILL.md)) |
| New public entry | Add Rollup `input` + `package.json` `exports` + `tsc` will emit matching `.d.ts` |
| App service repo | Keep esbuild — see watch-service `node-service-build` skill |

---

## Related

- [browser-node-exports](../browser-node-exports/SKILL.md) — what goes in each entry
- [browser-bundle-verification](../browser-bundle-verification/SKILL.md) — CI verification layers
- [library-exports](../library-exports/SKILL.md) — barrels and `package.json` exports
- [env-config](../env-config/SKILL.md) — `loadEnvFiles` on `/node` entry

## Reference files

| File | Role |
|------|------|
| `rollup.config.js` | Single-build dual entry + shared chunks |
| `dist/chunks/*.js` | Shared modules (incl. `supabase` singleton) |
| `tsconfig.dts.json` | Declaration emit |
| `scripts/verify-browser-entry.mjs` | Browser bundle gate |
| `package.json` | `build`, `dev`, peers, `exports` |
