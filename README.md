# target-supabase-sdk

Supabase client initializer and data access APIs for Target-based backends.

## Install

```bash
pnpm add target-supabase-sdk
```

This package declares `@supabase/supabase-js`, `@supabase/postgrest-js`, and `lodash-es` as **peer dependencies** — your app must have them available at runtime, but they are not bundled into the SDK itself. This avoids duplicate Supabase client instances and lets you control dependency versions.

**pnpm 8+** and **npm 7+** usually auto-install missing peer dependencies, so the command above is often enough.

If you see peer dependency warnings or `Cannot find module` errors at runtime, install them explicitly:

```bash
pnpm add target-supabase-sdk @supabase/supabase-js @supabase/postgrest-js lodash-es
```

> `@supabase/postgrest-js` is also pulled in transitively by `@supabase/supabase-js`; it is listed here because the SDK uses its types directly (e.g. `PostgrestFilterBuilder`).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Main Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Main project anon (public) key |
| `SUPABASE_NEED_AUTH_URL` | No | Separate auth project URL |
| `SUPABASE_NEED_AUTH_ANON_KEY` | No | Separate auth project anon key |

Used by `scripts/` (`pnpm worker:trigger`) via `.env.local`. Browser apps pass the same values to `supabase.initialize()` (e.g. `import.meta.env.VITE_SUPABASE_URL` if your bundler uses a `VITE_` prefix).

### Security

- Only use the **anon (public) key** in client or script env — it is designed to be public when protected by Row Level Security (RLS).
- **Never** put the `service_role` key in env files or frontend code. Use it only in trusted server-side environments.
- Do not commit `.env` or `.env.local`. They are gitignored; only `.env.example` (placeholders) should be tracked.
- Auth APIs return session tokens. Store them securely and never log them.

## Usage

### Browser / bundlers (default)

Chrome extensions, React, Vite — import from the main entry (no Node built-ins):

```typescript
import { supabase, getTarget, postLinkCreate, postTask } from "target-supabase-sdk";
```

`postTask` enqueues a task row (Zod payload only). Repo and params validation run at worker `prepareTask`, not at publish time.

### Node.js workers / CLI

Local task registry, repo script loading, TaskNode — use the `/node` entry:

```typescript
import { TaskManager, RepoManager, TaskNode, postTaskWithValidation } from "target-supabase-sdk/node";
```

Consumer services (e.g. [`../download-service`](../download-service), [`../watch-service`](../watch-service)) run `TaskNode` / `TriggerNode` with their own `config/task.config.js` and `tasks/` packages.

> **Breaking change in 0.2.0:** `TaskManager`, `RepoManager`, and `postTaskWithValidation` are no longer the only task publish path on `/node`. **`postTask`** (no Repo validation) is on the **default** browser entry and re-exported from `/node`.

### Browser vs Node (package layout)

Since **0.2.0**, the package ships two compiled entries:

| Import | Built file | Runtime |
|--------|------------|---------|
| `target-supabase-sdk` | `dist/browser.js` | Chrome extension, React, Vite — no Node built-ins |
| `target-supabase-sdk/node` | `dist/node.js` | Workers, CLI, TaskNode — includes browser API + Node-only code |
| `target-supabase-sdk/browser` | `dist/browser.js` | Explicit alias of default |

`src/browser.ts` is the curated browser public surface (includes `postTask`). `src/node.ts` re-exports browser and adds Node-only symbols (`TaskManager`, `postTaskWithValidation`, `RepoManager`, …).

### Initialize Supabase

```typescript
import { supabase, getTarget, loginUser } from "target-supabase-sdk";

await supabase.initialize({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  supabaseNeedAuthUrl: import.meta.env.VITE_SUPABASE_NEED_AUTH_URL,
  supabaseNeedAuthAnonKey: import.meta.env.VITE_SUPABASE_NEED_AUTH_ANON_KEY,
});

const target = await getTarget({ id: "..." });
```

### Service catalog

Register and discover HTTP-backed services and their Api capabilities in Supabase Target rows.

```typescript
import {
  postApi,
  postService,
  getService,
  getApi,
  discoverService,
  ApiMethod,
  ServiceLifecycleStatus,
} from "target-supabase-sdk";

// Register an Api capability
await postApi({
  name: "Upload Chunk",
  value: "storage.post.chunk.0",
  tagList: [],
  details: {
    method: ApiMethod.POST,
    path: "/v0/chunks",
    endpoint: "http://localhost:3100/v0/chunks",
    request: { query: [] },
    response: { "200": [] },
    manifestVersion: 0,
    lifecycle: {
      status: ServiceLifecycleStatus.ACTIVE,
      activeSince: "2026-01-01",
      deprecatedAt: null,
      sunsetAt: null,
    },
  },
});

// Register a Service that references Api keys
await postService({
  name: "Storage Service",
  value: "storage-service",
  tagList: [],
  details: {
    manifestVersion: 0,
    apiKeys: ["storage.post.chunk.0"],
    dependencies: [],
    lifecycle: { /* same shape as Api */ },
  },
});

// Discover — only returns ACTIVE services
const { data: service } = await discoverService({ value: "storage-service" });
```

| API | Description |
|-----|-------------|
| `postApi` / `getApi` | Create or fetch Api Target rows |
| `postService` / `getService` | Create or fetch Service Target rows (`getService` optional `lifecycleStatus` filter) |
| `discoverService` | Resolve a single ACTIVE service by `value`; errors: `SERVICE_NOT_FOUND`, `SERVICE_NOT_AVAILABLE` |

Types: `Service`, `Api`, `ApiDetails` (`method`, `path`, `endpoint`, `request`, `response`), `FieldDefinition` for inline schemas.

**Example consumers:** [`../storage-service`](../storage-service) (chunk upload/download), [`../watch-service`](../watch-service) (site scan scheduler), [`../download-service`](../download-service) (Chrome-backed `auto-chrome` executor).

### TriggerNode (local interval runners)

`TriggerNode` registers with Supabase (heartbeat, commands) and runs **in-process interval runners**. It does **not** read ENABLED trigger rows from the database (`trigger.api.ts` remains for admin/CLI).

Register runners in code **before** `start()` (registration closes on bootstrap):

```typescript
import {
  TriggerManager,
  TriggerNode,
  LOG_TOPIC_TRIGGER,
  postTask,
} from "target-supabase-sdk/node";

await supabase.initialize({ supabaseUrl, supabaseAnonKey });

TriggerManager.registerRunner({
  key: "daily-weather",
  intervalMs: 24 * 60 * 60 * 1000,
  retryCount: 3,
  retryDelayMs: 5_000,
  timeoutMs: 120_000,
  fn: async (ctx) => {
    const { error } = await postTask({ name: "weather", value: "weather", params: { city: "Tokyo" } });
    if (error) throw new Error(error.message);
    ctx.logger.success("task posted", { topic: LOG_TOPIC_TRIGGER });
  },
});

await new TriggerNode({ requireRunners: true }).start();
```

| Concept | Behavior |
|---------|----------|
| Main loop | Fixed **60s** (`TRIGGER_LOOP_INTERVAL_MS`) |
| `intervalMs` | Per-runner spacing; values `< 60s` are warned — effective precision is loop-bound |
| Registration | `registerRunner` before `start()`; `hasRunner` / `unregisterRunner` for lifecycle |
| Retries | `1 + retryCount` per tick; optional `retryDelayMs` between attempts |
| `timeoutMs` | Optional per-attempt limit; does not cancel in-flight work |
| Overlap | Running `fn` when due → skip tick (no backlog) |
| Parallel | Due runners in one round → `Promise.all` |
| Zero runners | Warn by default; `requireRunners: true` aborts bootstrap |
| Multi-instance | Run **one** TriggerNode per scheduler — duplicates fire the same runners |

CLI: `pnpm worker:trigger` (`scripts/run-trigger-node.ts` — log + `postTask` examples).

See `.cursor/skills/trigger-local-runners/SKILL.md`.

## Adding new modules (contributors)

When adding a domain, API, or Manager, **classify browser vs Node before** registering exports. The default entry must stay bundler-safe (Chrome extensions, Webpack, Vite).

### Decision flow

1. **Scan static dependencies** — grep the new code and everything it imports for `node:fs`, `node:crypto`, `node:path`, etc.
2. **Choose entry:**
   - No `node:*` in the chain → add to `src/browser.ts` (and domain `index.ts`)
   - Uses Node built-ins → add **only** to `src/node.ts` (consumers use `target-supabase-sdk/node`)
   - Same file mixes both → **split** into separate leaf modules (example: `task.api.ts` vs `task-post.api.ts`)
3. **Build** — `pnpm build` runs Rollup (dual entry `browser.js` + `node.js`, shared chunks), `tsc --emitDeclarationOnly` for types, then `scripts/verify-browser-entry.mjs`, which scans the bundled `dist/browser.js` and fails if it contains `from "node:…"` imports.

```bash
pnpm build
# [verify:browser] OK — dist/browser.js bundle has no node: imports.
```

Node entry (`/node`) is bundled by the same Rollup build (peers and `node:*` stay external); there is no separate verify script for it.

### Rules of thumb

| Safe on default entry `.` | Node entry `/node` only |
|---------------------------|-------------------------|
| `*.interface.ts`, Supabase RPC `*.api.ts` | `TaskManager`, `RepoManager`, `TaskNode`, `TriggerNode`, `TriggerManager` |
| `createTarget`, `postLinkCreate`, task `patch*` APIs, **`postTask`** | `postTaskWithValidation`, `TaskRepoValidation` |
| `repo.api` (remote) | `local-task-registry`, `repo.script-loader` |

**Do not rely on dynamic `import()`** to hide Node code: if `browser.ts` statically re-exports a file, bundlers include the whole module. Keep Node-only code in separate files that `browser.ts` never touches.

**Internal imports:** within a domain, import leaf paths (`from "./task.api"`) not the domain barrel (`from "./index"`) to avoid cycles.

Detailed conventions: `.cursor/skills/browser-node-exports/SKILL.md` and `.cursor/skills/library-exports/SKILL.md`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm format        # Biome: format + lint + organize imports (write)
pnpm format:check  # CI gate (read-only)
pnpm build
pnpm dev
```

Verify the publishable tarball locally (runs `prepack` → full build):

```bash
pnpm pack:check
```

CI runs `pnpm build` then `npm pack --dry-run --ignore-scripts` so the tarball check does not rebuild.

## Release

Publishing is automated via GitHub Actions when a version tag is pushed.

### One-time setup

1. Create an npm [Granular Access Token](https://www.npmjs.com/settings/~your-username/tokens) with **Read and Write** permission and **Bypass 2FA for automation** enabled.
2. Add it to the GitHub repository as a secret named `NPM_TOKEN`:
   - Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### Publish a new version

```bash
npm version patch
git push
git push --tags
```

- `npm version patch` — bump version (`0.1.0` → `0.1.1`), commit, and create git tag `v0.1.1`. Use `minor` or `major` when needed.
- `git push` — push the version commit to GitHub
- `git push --tags` — push the tag; triggers `.github/workflows/release.yml` to publish to npm

First push on a new machine (set upstream once):

```bash
git push -u origin main
git push --tags
```

PowerShell 5.x does not support `&&`. Run each command on its own line, or use `git push; git push --tags`.

The release workflow will:

1. Verify the git tag matches `package.json` version (e.g. tag `v0.1.1` ↔ version `0.1.1`)
2. Build the package
3. Publish to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements)

### Manual publish (fallback)

```bash
pnpm pack:check
npm publish --otp=YOUR_2FA_CODE
```

## License

MIT
