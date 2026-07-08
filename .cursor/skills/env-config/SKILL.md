---
name: env-config
description: >-
  Environment loading and parsing for target-supabase-sdk/node: loadEnvFiles,
  requireEnv, envMs/envPort, resolveProjectRootFromModule, publicBaseUrlFromEnv,
  initSupabaseFromStandardEnv. Use when implementing service env.ts, preload-env,
  or Supabase bootstrap from SUPABASE_* keys.
---

# Env config (target-supabase-sdk/node)

## Import

```typescript
import {
  loadEnvFiles,
  requireEnv,
  readEnv,
  envMs,
  envPort,
  envInt,
  envNumber,
  envBool,
  resolveProjectRootFromModule,
  resolveProjectRootByPackageName,
  publicBaseUrlFromEnv,
  initSupabaseFromStandardEnv,
} from "target-supabase-sdk/node";
```

Location: `src/node/env/`

## Phase 1 — load + parse

```typescript
// esbuild bundles: walk up to package.json by name (dist/ is not repo root)
const projectRoot = resolveProjectRootByPackageName(import.meta.url, "storage-service");

// tsx / fixed depth (e.g. scripts/preload-env.mjs one level below root)
const projectRoot = resolveProjectRootFromModule(import.meta.url, "..");
```

loadEnvFiles(projectRoot, {
  afterLoad: () => { /* legacy alias hooks */ },
});

const url = requireEnv("SUPABASE_URL");
const timeout = envMs("STARTUP_READY_TIMEOUT_MS", 180_000);
const port = envPort(3100);
```

| API | Purpose |
|-----|---------|
| `loadEnvFiles` | `.env.local` → `.env`, no overwrite of existing env |
| `requireEnv` / `readEnv` | Required vs optional string |
| `envMs` / `envInt` / `envPort` / `envNumber` / `envBool` | Typed parsers |

## Phase 2 — Supabase init

```typescript
await initSupabaseFromStandardEnv({
  root: projectRoot,
  afterLoadEnv: normalizeLegacyAliases,
});
```

Requires: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Optional auth URL keys.

## Phase 3 — public URL

```typescript
const baseUrl = publicBaseUrlFromEnv(port, { envKey: "STORAGE_PUBLIC_URL" });
```

## Service L3 pattern

Keep domain getters in `src/env.ts`:

- Telegram / supervisor / upload limits
- `afterLoad` hooks (e.g. `BOT_TOKEN` → `TELEGRAM_BOT_TOKEN`)
- Thin wrappers calling SDK parsers

## Preload script

`scripts/preload-env.mjs` should call `loadEnvFiles` from SDK (same parser as app code).

## Reference

`storage-service/src/env.ts`, `scripts/preload-env.mjs`

## Do not

- Put service-specific env keys in SDK
- Import `node/env` from browser entry
- Duplicate `.env` parsing in preload and `env.ts`
