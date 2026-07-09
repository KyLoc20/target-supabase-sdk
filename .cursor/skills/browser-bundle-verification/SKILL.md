---
name: browser-bundle-verification
description: >-
  Browser bundle safety and dual-entry packaging verification for target-supabase-sdk.
  Use when choosing CI guards against node:fs leaks, comparing verify-graph vs dependency-cruiser
  vs ESLint vs bundler checks, extending scripts/verify-graph.mjs, or planning packaging TODOs.
---

# Browser bundle verification (target-supabase-sdk)

Complements [browser-node-exports](../browser-node-exports/SKILL.md) (what goes in `browser.ts` / `node.ts`). This skill covers **how to verify** the browser graph stays Node-free, **external tools**, and **future TODO**.

## One-line rule

**No single tool replaces layered checks.** SDK publish uses `verify-browser-entry` on `dist/`; consumers still need bundler CI. Optional: `dependency-cruiser` on `src/`, `publint` / ATT W on publish.

---

## Problem space

| Risk | Example |
|------|---------|
| Static import pulls Node code into browser graph | `task.api.ts` → `task-post.api.ts` → `RepoManager` |
| Transitive `node:` built-ins | `shared/` accidentally imports `node:fs` |
| Wrong package entry | `import { TaskManager } from "target-supabase-sdk"` after 0.2.0 |
| Types/exports mismatch | `exports` map resolves wrong `.d.ts` in bundlers |

**Dynamic `import()` inside a function does not remove a module from the graph if anything still statically imports that file.**

---

## In-repo solution (current)

```text
pnpm build
  → rollup → dist/browser.js + dist/node.js (bundles)
  → tsc -p tsconfig.dts.json → dist/**/*.d.ts
  → scripts/verify-browser-entry.mjs
       → scan dist/browser.js for from "node:…" (single-file bundle)
```

See [rollup-library-build](../rollup-library-build/SKILL.md) for build rationale and consumer impact.

### `verify-browser-entry.mjs` behavior (Rollup era)

| Feature | Detail |
|---------|--------|
| Entry | `dist/browser.js` bundle only |
| Detection | Regex `from "node:…"` in bundle text |
| Node entry | Rollup `dist/node.js`; peers + `node:*` external — not separately scanned |

### Legacy: `verify-graph.mjs`

Graph walker for **multi-file** `tsc` `dist/` — optional for tooling; **not** used by CI after Rollup migration. Keep for fixtures or dependency-cruiser comparison.

### What verify does **not** cover

- Bare imports (`"zod"`, `"@supabase/supabase-js"`) — npm packages not walked
- Dynamic `import("…")`
- Runtime APIs without `node:` (`process.on` in files not in browser graph — OK if graph is correct)
- Consumer bundler config (fallbacks, shims, polyfills)

---

## External tools (comparison)

| Tool | Layer | Strength | Weakness vs our need |
|------|-------|----------|----------------------|
| **verify-graph** (in-repo) | post-`tsc` `dist/` | Zero deps, matches compiled output, CI in `pnpm build` | No npm graph; regex-based |
| **[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)** | `src/` dev/CI | Rich `forbidden` rules, `./`+`../`, reports, TS paths | Extra config; usually src not dist |
| **ESLint** `import/no-nodejs-modules`, `n/no-restricted-import` | editor + lint | Immediate feedback on bad imports | Not full transitive graph |
| **ESLint** `import/no-restricted-paths` | zone rules | Block `browser.ts` → `repo-manager` | Manual path matrix |
| **Webpack / Vite / Rollup / esbuild** | consumer build | Real bundle truth (`platform: 'browser'`, `fallback: false`) | Runs in extension app, not SDK repo |
| **[publint](https://publint.dev/)** | publish | Validates `exports`, types paths | Not node: leak detection |
| **[@arethetypeswrong/cli](https://github.com/arethetypeswrong/arethetypeswrong.github.io)** | publish | `exports` + types under bundler resolution | Not runtime import safety |
| **madge / knip** | analysis | Cycles, unused deps | Not purpose-built for browser/node split |
| **`package.json` `"browser"` field** | legacy | Map `fs: false` | Superseded by explicit dual entry for this SDK |

**Closest off-the-shelf substitute for verify-graph:** dependency-cruiser with forbidden rules from `src/browser.ts`.

Example rule sketch:

```javascript
// .dependency-cruiser.cjs — not yet adopted; see Future TODO
module.exports = {
  forbidden: [
    { name: "browser-no-node-builtins", from: { path: "^src/browser\\.ts$" }, module: "^node:" },
    { name: "browser-no-repo-manager", from: { path: "^src/browser\\.ts$" }, to: { path: "repo-manager" } },
    { name: "browser-no-task-post", from: { path: "^src/browser\\.ts$" }, to: { path: "task-post\\.api" } },
  ],
};
```

---

## Recommended layered defense

```text
Layer 1 — Design (browser-node-exports skill)
  browser.ts / node.ts split; postTask in task-post.api.ts (browser-safe); postTaskWithValidation in task-post-validated.api.ts

Layer 2 — SDK CI (current)
  pnpm build → verify-browser-entry on dist/

Layer 3 — Optional SDK dev (Future TODO)
  dependency-cruiser on src/
  publint + @arethetypeswrong/cli on prepack

Layer 4 — Consumer (extension / host app)
  vite/webpack build in CI with browser target
```

---

## When to extend verify-graph vs adopt a library

| Situation | Action |
|-----------|--------|
| New internal `../` barrel (`dir/index.js`) | Already handled — ensure verify resolves `index.js` |
| New `node:` namespace (`node:stream`, `node:worker_threads`) | Extend `NODE_BUILTIN_IMPORT_PATTERN` in `verify-graph.mjs` |
| Need forbidden rules on **source** paths (`src/browser.ts` → X) | Prefer dependency-cruiser (Future TODO) |
| npm package ships Node code | Bundler CI in consumer; consider documenting peer browser field |
| False sense of security after green verify | Remind: run extension `vite build` periodically |

---

## Future TODO

Track when improving packaging CI. Check off in PRs that implement each item.

### P1 — High value, low friction

- [ ] **dependency-cruiser** — add devDependency + `.dependency-cruiser.cjs` with forbidden rules from `src/browser.ts` (mirror verify intent on `src/`). Script: `"verify:deps": "depcruise src/browser.ts --config"`.
- [ ] **Expand `NODE_BUILTIN_IMPORT_PATTERN`** — include `node:stream`, `node:worker_threads`, `node:module` if SDK ever touches them (keep list aligned with Node docs).
- [ ] **Document verify limits** in README or browser-node-exports — bare imports + dynamic import not scanned.

### P2 — Publish hygiene

- [ ] **publint** — run in `prepack` or CI (`publint package.json`).
- [ ] **@arethetypeswrong/cli** — validate `exports` + `.d.ts` for `.` and `./node` (`attw --pack .`).

### P3 — End-to-end

- [ ] **Consumer smoke build** — minimal Vite/Webpack fixture (or chrome-extension-starter CI) that imports `target-supabase-sdk` and asserts build success.
- [ ] **node.ts type exports** — re-export `BootstrapLocalTasksOptions`, `RepoContextFailureReason` from `node.ts` (see browser-node-exports audit).

### P4 — Nice to have

- [ ] **Shared log on browser entry** — only if extension consumers need public `createLogger` (today internal-only via `task.api`).
- [ ] **verify-graph unit test** — small fixture `dist/` tree in `scripts/__fixtures__/` for regression on `../` + `index.js` resolution.
- [ ] **Deep-import guard** — document or lint against `target-supabase-sdk/src/task/index` (package `files` includes `src/`).

---

## Agent workflow

When user asks about browser bundling, webpack `node:fs` errors, or packaging tools:

1. Read [browser-node-exports](../browser-node-exports/SKILL.md) — entry split first.
2. Run `pnpm build` — verify-browser must pass.
3. If leak is transitive, trace static imports (`rg 'from.*repo-manager' src/`).
4. Recommend tool from comparison table — do not claim one tool fixes everything.
5. If implementing CI improvement, pick an unchecked **Future TODO** item and update this section.

---

## Related

- [browser-node-exports](../browser-node-exports/SKILL.md) — dual entry, postTask split
- [rollup-library-build](../rollup-library-build/SKILL.md) — SDK Rollup bundles
- watch-service app build: `watch-service/.cursor/skills/node-service-build/SKILL.md` (esbuild — not Rollup)
- [library-exports](../library-exports/SKILL.md) — barrel rules
- [barrel-import-cycles](../barrel-import-cycles/SKILL.md) — leaf imports inside domains

## Reference files

| File | Role |
|------|------|
| `rollup.config.js` | Dual entry Rollup config |
| `scripts/verify-graph.mjs` | Legacy graph walker (optional; CI uses bundle scan) |
| `scripts/verify-browser-entry.mjs` | CI gate on browser bundle |
| `package.json` `exports` | `"."` → browser, `"./node"` → node |
