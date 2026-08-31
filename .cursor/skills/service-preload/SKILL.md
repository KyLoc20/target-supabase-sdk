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
| Logic in SDK | ✅ | `loadEnvFiles`, `validateLogSpoolPreloadEnv`, root resolve already in `/node` |
| Service-only `preload.mjs` | ✅ | Pass `packageName` + `serviceValue` (+ optional hooks) |
| Replace 3-file chain | ✅ | `preload-env` + `preload-log-persist` merge into SDK runner |
| `preload-diagnostics` | ⏸️ | No active task today — **remove** from chain; leave TODO in SDK runner |
| Async work in preload | ❌ | `initSupabaseFromStandardEnv`, `ensureLogSpoolFromEnv` stay in app `main()` |
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

Phase 3½ — Global log min level (after env load)
  resolveLogMinLevel({ defaultLevel: options.defaultLogMinLevel })
  logManager.setOptions({ minLevel }) when applyLogMinLevel !== false
    • LOG_MIN_LEVEL env: DEBUG | INFO | SUCCESS | WARN | ERROR | CRITICAL
    • unset → options.defaultLogMinLevel ?? (DEBUG in dev, INFO in prod)

Phase 4 — Cross-cutting validation
  validateLogSpoolPreloadEnv() when LOG_PERSIST_ENABLED

Phase 5 — Process diagnostics
  // TODO: optional unhandledRejection / uncaughtException formatters
  // Previously watch-service preload-diagnostics.mjs — not enabled in v1

─── NOT in preload (app entry, async) ───
  await initSupabaseFromStandardEnv({ root })
  await ensureLogSpoolFromEnv()   // guard / scheduler / worker; main via createServiceHost after claim
```

## Service contract

### Required: `scripts/preload.mjs`

```javascript
import { LogLevel } from "target-supabase-sdk";
import { runServicePreload } from "target-supabase-sdk/preload";

runServicePreload({
    callerImportMetaUrl: import.meta.url,
    packageName: "watch-service",
    serviceValue: "watch-service",
    runtimeDataDirRelative: "data/runtime",
    // optional: service-specific default when LOG_MIN_LEVEL unset
    // defaultLogMinLevel: LogLevel.WARN,
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

Launcher sets `LOG_PERSIST_PROCESS` per child (`guard` | `scheduler` | `worker`). Main spool is enabled by `createServiceHost` after registry claim (`processRole: "main"`).

## Log file spool (multi-process)

When `LOG_PERSIST_ENABLED=true`, each process enables a **file spool writer** (`ensureLogSpoolFromEnv`). Logs buffer in memory, flush to `{RUNTIME_DATA_DIR}/log-spool/{serviceId}/{role}/*.tmp`. The **guard** uploads batches via `registerCollectLogRunner` — no cross-process registry heartbeat.

See [log-spool](../log-spool/SKILL.md) and [`src/shared/log/README.md`](../../src/shared/log/README.md).

| Concern | Approach |
|---------|----------|
| Producer write | Per-process `.tmp` files (atomic `.part` → rename) |
| Upload | Guard-only `collect-log` runner |
| Sync tracking | `.tmp` / `.json` suffix per batch file (no central index) |
| Child `serviceId` | `ManagedChildProcesses.spawn` auto-injects `LOG_SPOOL_SERVICE_ID` |
| Extra roles (e.g. `chrome-sidecar`) | `runServicePreload({ logSpoolExtraProcessRoles: [...] })` or env |

**Do not** use a shared JSON registry file that all processes read-modify-write — same Windows `EPERM` lessons as [json-state-store](../json-state-store/SKILL.md). Runtime gate state uses `createServiceRuntimeStateStore` (sharded `runtime-state/*.json`).

## SDK surface (planned)

| Export path | Symbol | Role |
|-------------|--------|------|
| `target-supabase-sdk/preload` | `runServicePreload` | Main entry — runs all sync phases |
| `target-supabase-sdk/preload` | `ServicePreloadOptions` | Type (re-export or `.d.ts`) |
| `target-supabase-sdk` | `resolveLogMinLevel`, `LOG_MIN_LEVEL_ENV_KEY` | Parse `LOG_MIN_LEVEL` (also applied in preload) |
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
    /** Default when LOG_MIN_LEVEL unset; SDK default DEBUG in dev / INFO in prod */
    defaultLogMinLevel?: LogLevel;
    /** Apply logManager.setOptions from env (default true) */
    applyLogMinLevel?: boolean;
}
```

### `LOG_MIN_LEVEL` (.env)

See SDK `.env.example`. Applied in Phase 3½ — affects **this process** console output and log-persist offers (not inbound LogBatch from other services).

| Value | Rank |
|-------|------|
| DEBUG | lowest |
| INFO / SUCCESS | |
| WARN | |
| ERROR / CRITICAL | highest |

Unset: `defaultLogMinLevel` option, else DEBUG when `NODE_ENV !== production`, else INFO.

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
| manual `logManager.setOptions` in preload.mjs | Phase 3½ |

## Do not

- Put `await initSupabaseFromStandardEnv()` in preload
- Put `await ensureLogSpoolFromEnv()` in preload
- Use absolute paths in `--import` on Windows
- Duplicate `.env` parsing in service `env.ts` and preload (preload loads; app reads `process.env`)
- Reintroduce multi-file preload chains in new services
- Use a shared JSON registry for log readiness — file spool uses per-process `.tmp` / `.json` instead

## Related skills

- [env-config](../env-config/SKILL.md) — Phase 2 parsers, Phase 2b Supabase init in app
- [log-spool](../log-spool/SKILL.md) — file spool layout and L3 integration
- [process-spawn](../process-spawn/SKILL.md) — `preloadModules` single path
