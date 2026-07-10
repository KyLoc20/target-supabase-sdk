---
name: service-preload
description: >-
  Unified Node --import preload protocol for services on target-supabase-sdk:
  one scripts/preload.mjs per service, runServicePreload from target-supabase-sdk/preload.
  Use when adding preload scripts, migrating off preload-env/diagnostics chains, or
  configuring launcher spawnTsxChild preloadModules.
---

# Service preload (target-supabase-sdk)

## Goal

Every Node service uses **one** preload file. All cross-cutting preload steps live in the SDK; the service only supplies identity + optional L3 hooks.

```text
node --import ./scripts/preload.mjs dist/index.js
         │
         ▼
  service/scripts/preload.mjs     ← thin: calls runServicePreload(options)
         │
         ▼
  target-supabase-sdk/preload   ← SDK: env, defaults, validation (sync only)
```

## Feasibility

| Item | Verdict | Notes |
|------|---------|-------|
| Single `--import` per process | ✅ | Node supports one or more; one relative path is enough if SDK orchestrates internally |
| Logic in SDK | ✅ | `loadEnvFiles`, `validateLogPersistPreloadEnv`, root resolve already in `/node` |
| Service-only `preload.mjs` | ✅ | Pass `packageName` + `serviceValue` (+ optional hooks) |
| Replace 3-file chain | ✅ | `preload-env` + `preload-log-persist` merge into SDK runner |
| `preload-diagnostics` | ⏸️ | No active task today — **remove** from chain; leave TODO in SDK runner |
| Async work in preload | ❌ | `initSupabaseFromStandardEnv`, `ensureLogPersistFromEnv` stay in app `main()` |
| Windows `--import` paths | ✅ | Service preload stays **relative** (`./scripts/preload.mjs`); SDK resolved via package exports |
| Child spawn | ✅ | `spawnTsxChild({ preloadModules: ["./scripts/preload.mjs"] })` |

**Conclusion:** Feasible. Ship `target-supabase-sdk/preload` as a small ESM entry (build artifact), not as part of the heavy app import graph.

## Preload protocol (sync phases)

Executed by `runServicePreload(options)` — **must remain synchronous** (Node `--import` runs before entry).

```text
Phase 1 — Resolve project root
  resolveProjectRootByPackageName(callerImportMetaUrl, options.packageName)
  callerImportMetaUrl = service scripts/preload.mjs import.meta.url

Phase 2 — Load .env files
  loadEnvFiles(projectRoot, { afterLoad: options.afterLoadEnv })
  Order: .env.local → .env (no overwrite of existing process.env)

Phase 3 — Service env defaults (SDK helpers + L3 hook)
  applyServiceEnvDefaults(projectRoot, options)
    • LOG_PERSIST_SERVICE ← options.serviceValue (when LOG_PERSIST_ENABLED)
    • RUNTIME_DATA_DIR ← options.runtimeDataDirRelative ?? "data/runtime"
  options.applyEnvDefaults?.(projectRoot)   // L3: legacy aliases, domain keys

Phase 4 — Cross-cutting validation
  validateLogPersistPreloadEnv() when LOG_PERSIST_ENABLED

Phase 5 — Process diagnostics
  // TODO: optional unhandledRejection / uncaughtException formatters
  // Previously watch-service preload-diagnostics.mjs — not enabled in v1

─── NOT in preload (app entry, async) ───
  await initSupabaseFromStandardEnv({ root })
  await ensureLogPersistFromEnv({ process, service, registryFilePath })
```

## Service contract

### Required: `scripts/preload.mjs`

```javascript
import { runServicePreload } from "target-supabase-sdk/preload";

runServicePreload({
    callerImportMetaUrl: import.meta.url,
    packageName: "watch-service",
    serviceValue: "watch-service",
    runtimeDataDirRelative: "data/runtime",
    // optional L3:
    // afterLoadEnv: () => { ... },
    // applyEnvDefaults: (projectRoot) => { ... },
});
```

### Required: `package.json` scripts + launcher

```json
"start": "node --import ./scripts/preload.mjs dist/index.js"
```

```typescript
const PRELOAD_MODULES = ["./scripts/preload.mjs"] as const;

spawnTsxChild({
    preloadModules: PRELOAD_MODULES,
    env: { ...process.env, LOG_PERSIST_PROCESS: label },
});
```

### Child process env

Launcher sets `LOG_PERSIST_PROCESS` per child (`guard` | `scheduler` | `worker`). Main passes `process: "main"` in `ensureLogPersistFromEnv`.

## SDK surface (planned)

| Export path | Symbol | Role |
|-------------|--------|------|
| `target-supabase-sdk/preload` | `runServicePreload` | Main entry — runs all sync phases |
| `target-supabase-sdk/preload` | `ServicePreloadOptions` | Type (re-export or `.d.ts`) |
| `target-supabase-sdk/node` | existing env/log APIs | Used by runner implementation |

### `ServicePreloadOptions`

```typescript
interface ServicePreloadOptions {
    /** import.meta.url from service scripts/preload.mjs */
    callerImportMetaUrl: string;
    /** package.json name — for resolveProjectRootByPackageName */
    packageName: string;
    /** LOG_PERSIST_SERVICE default when persistence enabled */
    serviceValue: string;
    /** Relative to project root; default "data/runtime" */
    runtimeDataDirRelative?: string;
    /** Passed to loadEnvFiles afterLoad */
    afterLoadEnv?: () => void;
    /** L3 hook after SDK defaults (legacy aliases, etc.) */
    applyEnvDefaults?: (projectRoot: string) => void;
}
```

## Build layout (SDK)

Add a **lightweight** preload bundle — do not require services to import full `dist/node.js` in preload if avoidable; acceptable v1: preload.mjs re-exports runner that imports from `./node.js` (same singleton as app).

```text
supabase-sdk/
  src/node/preload/
    run-service-preload.ts    # implementation + phase comments
    index.ts                  # export runServicePreload
  scripts/build-preload.mjs   # or rollup entry → dist/preload.mjs
  package.json exports:
    "./preload": { "import": "./dist/preload.mjs" }
```

## Migration checklist (per service)

- [ ] Add `scripts/preload.mjs` calling `runServicePreload`
- [ ] Remove `preload-env.mjs`, `preload-diagnostics.mjs`, `preload-log-persist.mjs`
- [ ] Update `package.json` all process scripts → single `--import ./scripts/preload.mjs`
- [ ] Update `launcher.ts` `PRELOAD_MODULES` → `["./scripts/preload.mjs"]`
- [ ] Keep `initSupabaseFromEnv` + `ensureWatchLogPersist` in each process `main()`
- [ ] Update `node-service-build` / service SKILL cross-links

## Reference (current watch-service, pre-migration)

| Old file | Absorbed into |
|----------|----------------|
| `preload-env.mjs` | Phase 2 |
| `preload-log-persist.mjs` | Phase 3–4 |
| `preload-diagnostics.mjs` | Phase 5 TODO (removed) |

## Do not

- Put `await initSupabaseFromStandardEnv()` in preload
- Put `await ensureLogPersistFromEnv()` in preload
- Use absolute paths in `--import` on Windows
- Duplicate `.env` parsing in service `env.ts` and preload (preload loads; app reads `process.env`)
- Reintroduce multi-file preload chains in new services

## Related skills

- [env-config](../env-config/SKILL.md) — Phase 2 parsers, Phase 2b Supabase init in app
- [process-spawn](../process-spawn/SKILL.md) — `preloadModules` single path
- watch-service [node-service-build](../../../watch-service/.cursor/skills/node-service-build/SKILL.md) — esbuild + `node dist`
