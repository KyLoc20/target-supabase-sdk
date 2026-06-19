---
name: task-local-discovery
description: >-
  Local task discovery, registration, and runtime JS dynamic loading in target-supabase-sdk.
  Use when implementing or reviewing task.config.js, bootstrapLocalTasks, RepoManager,
  prepareTask, bindTaskFn, ExecutableTaskFn, task plugins, worker availableTaskList,
  patchChangeTaskStatus, patchClaimTask, or remote vs local script loading.
---

# Task discovery & runtime loading (target-supabase-sdk)

## Current decisions (do not change without explicit request)

1. **Runtime loads JavaScript only** — native Node ESM `import()`. Do **not** add tsx/jiti to the SDK loader by default.
2. **Config files are JS** — `config/task.config.js` and per-task `task.config.js` (native `import()`).
3. **Task authoring may use TS** — only if compiled to `.js`/`.mjs` before run; `entry` points at JS artifact.
4. **No `Script` Target subtype in `repo.interface.ts`** — script shapes live in `task-repo-context.ts` (`TaskRepoScriptRecord`, etc.).
5. **Local registration beats remote** — `RepoManager` local registry is checked before Supabase fetch.

---

## Why JS at runtime (not TS)

Industry pattern for dynamic plugin loading:

```text
Author (TS optional) → Build → JS artifact → runtime import("./entry.js")
```

| Runtime load | Verdict |
|--------------|---------|
| **Compiled JS / `.mjs`** | ✅ Default — stable, no loader dep, hash/cache friendly |
| **Direct `.ts` import** | ❌ Not supported — requires tsx/jiti; avoid in SDK production path |
| **Inline `source` in DB** | ✅ JS string → temp `.mjs` file → `import()` |

TS remains valuable at **author + CI typecheck** (`TaskRepoContext` types from SDK). It is not loaded at runtime.

---

## Host app layout

```text
<host-project>/
  config/task.config.js          ← committed; `{ taskDir: "./tasks" }`
  tasks/                         ← gitignored; local task packages
    my-task/
      task.config.js             ← `{ taskTypeKey, entry, ... }`
      index.mjs                  ← exports TaskRepoContext (JS)
  tasks.example/                 ← committed template (copy to tasks/)
```

Legacy fallback: `./task.config.js` at project root (discouraged; prefer `config/`).

`.gitignore`: ignore `tasks/` only — **not** `config/task.config.js`.

---

## End-to-end flow

```text
Worker start
  → TaskManager.runWorkerLocalTaskBootstrap(availableTaskList)
       → bootstrapLocalTasks()  [discover + register]
       → log internally
       → if availableTaskList empty → use registered taskTypeKeys

patchClaimTask → Task (see [task-state-machine](../task-state-machine/SKILL.md))

NodeManager.executeTask
  → TaskManager.prepareTask({ logger, task })
       → RepoManager.getRepoContext({ taskTypeKey, repo })
            1. local registry hit → dynamic import(modulePath) on first use
            2. else Supabase repo + script rows → loadRepoContextFromScript
       → taskParamsValidator(params)
       → bindTaskFn → ExecutableTaskFn (params closed over)

await taskFn() → onTaskSuccess / onTaskFailed
```

---

## Why `bindTaskFn` (closure bind params)

`prepareTask` ends with `bindTaskFn(repoContext.taskFn, taskParams)` → `ExecutableTaskFn`.
This is an **interface design choice**, not a runtime limitation — you *could* return
`{ taskFn: TaskFn, taskParams }` and call `await taskFn(taskParams)` in `executeTask`.

### Two shapes

| | Direct param pass | Closure bind (current) |
|---|---|---|
| `prepareTask` returns | `TaskFn` + `params` | `ExecutableTaskFn` (zero-arg) |
| `executeTask` calls | `await taskFn(taskParams)` | `await taskFn()` |
| Executor knows about params? | Yes — must read/pass them | No — params already inside |

```typescript
// task-manager.ts — bind at prepare time
function bindTaskFn(taskFn: TaskFn, taskParams: unknown): ExecutableTaskFn {
    const run = async () => taskFn(taskParams);
    return Object.assign(run, { displayName: taskFn.displayName, taskTypeKey: taskFn.taskTypeKey });
}

// node-manager.ts — executor only runs the prepared callable
const { taskFn } = await TaskManager.prepareTask({ logger, task });
await taskFn();
```

### Why closure bind here

1. **Separation of concerns** — `prepareTask` owns the full pipeline (load Repo → validate params → assemble runnable). `executeTask` only runs and handles `TaskRunResult`; it never touches `task.details.params` again.
2. **Params frozen after validation** — the closure captures the params snapshot that passed `taskParamsValidator`. Execution cannot accidentally pass stale/wrong params from a different source.
3. **Simpler executor API** — one return value (`ExecutableTaskFn`) beats a `(TaskFn, params)` pair at every call site.
4. **Portable “ready job”** — defer, queue, or hand off to another module with a single function reference; no second argument to keep in sync.
5. **Clear author vs SDK boundary** — task plugins export `taskFn(params): Promise<TaskRunResult>` (`TaskFn`); the SDK injects Supabase-claimed params at prepare time and hides that from the runner.

### When direct param pass is better

Prefer returning `TaskFn` + `params` separately when:

- params must be **mutated after prepare** but before run;
- the same `taskFn` must run **multiple times with different params** in one session;
- callers need explicit access to raw params for logging/metrics beside execution.

Current worker flow is **claim once → prepare once → run once** with params fixed at prepare time — closure bind fits.

### Do not change without explicit request

- Do not remove `bindTaskFn` and push param passing into `NodeManager.executeTask` unless the user asks — it widens executor responsibility and duplicates param lifecycle.
- Do not make task plugin authors export zero-arg functions — plugins stay `(params) => TaskRunResult`; binding is SDK-only in `prepareTask`.

---

## Config contracts

### Root — `config/task.config.js`

```javascript
export default {
    taskDir: "./tasks",  // relative to this config file's directory
};
```

Field name is **`taskDir`** (not `tasksDir`).

### Per-task — `tasks/<name>/task.config.js`

```javascript
export default {
    taskTypeKey: "my-task",   // must match task.value / patchClaimTask filter
    entry: "./index.mjs",     // JS only — relative to this task folder
    exportName: undefined,    // optional named export; else default
    displayName: "My Task",   // optional
    enabled: true,            // false → skip
};
```

### Entry module — `index.mjs`

Supported export shapes (see `normalizeRepoContextModule` in `repo-context.utils.ts`):

```javascript
// Preferred
export default {
    taskParamsValidator(params) { return params != null; },
    async taskFn(params) {
        return { isSuccess: true, cost: 0, nextTaskStatus: "DONE", extra: null };
    },
};

// Also: named exports { taskParamsValidator, taskFn }
// Also: export default taskFn only (validator defaults to () => true)
```

Return shape: `TaskRunResult` — `{ isSuccess, cost, nextTaskStatus, extra }`.

---

## API surface

| API | Role |
|-----|------|
| `TaskManager.bootstrapLocalTasks(options?)` | Scan configs → `RepoManager.registerLocalModule`; **never throws** on missing root config |
| `TaskManager.runWorkerLocalTaskBootstrap(availableTaskList)` | Bootstrap + log + merge list; use in worker startup |
| `TaskManager.prepareTask({ logger, task })` | Resolve context, validate params, return `ExecutableTaskFn` |
| `TaskManager.getRegisteredLocalTaskTypeKeys()` | Keys in local registry |
| `RepoManager.registerLocalRepoContext(key, ctx)` | Manual in-process register (dev/tests) |
| `RepoManager.registerLocalModule(key, path, exportName?)` | Manual path register |

### `bootstrapLocalTasks` status (no throw for `not_configured`)

| `status` | Meaning |
|----------|---------|
| `not_configured` | No root config found — skip local tasks; remote/manual still OK |
| `loaded` | ≥1 task registered |
| `empty` | Config OK, zero registrations |
| `failed` | Invalid root config, missing `taskDir`, or all packages failed |

Per-task failures go to `errors[]`; other tasks still register.

### Worker integration (business code stays thin)

```typescript
// node-manager.ts — do NOT duplicate bootstrap switch/logging here
if (!this.isController) {
    this._availableTaskList = await TaskManager.runWorkerLocalTaskBootstrap(this._availableTaskList);
}
```

---

## RepoManager load priority

1. **Local registry** (`registerLocalModule` / bootstrap)
2. **Supabase remote**
   - Fetch `category=repo`, verify `task.details.repo.details.hash` if present
   - Fetch script rows: `category=script`, match `value` or `details.repoKey`
   - Pick entry: `details.isEntry === true` or first row
   - Load via `modulePath` or inline `source` → temp file

Caches: local module import cache, remote context cache by `taskTypeKey@repoHash`.

---

## Types (`src/task/task-repo-context.ts`)

| Type | Purpose |
|------|---------|
| `TaskRepoContext` | `{ taskParamsValidator, taskFn }` |
| `TaskFn` | Plugin export: `(params) => Promise<TaskRunResult>` + `displayName`, `taskTypeKey` |
| `ExecutableTaskFn` | After `bindTaskFn`: params closed over; `() => Promise<TaskRunResult>` — used by `executeTask` only |
| `TaskRunnerRootConfig` | `{ taskDir }` |
| `TaskLocalPackageConfig` | Per-task config shape |
| `TaskRepoScriptRecord` / `TaskRepoScriptDetails` | Remote script rows (not `repo.interface` Target) |

Constants: `TASK_RUNNER_ROOT_CONFIG_RELATIVE_PATH` = `config/task.config.js`, `TASK_LOCAL_PACKAGE_CONFIG_FILENAME` = `task.config.js`.

---

## Implementation map

| Concern | File |
|---------|------|
| Config scan + bootstrap | `src/task/local-task-registry.ts` |
| prepareTask + bind params | `src/task/task-manager.ts` |
| Types + config contracts | `src/task/task-repo-context.ts` |
| Local registry + remote fetch | `src/repo/repo-manager.ts` |
| Dynamic `import()` + source temp file | `src/repo/repo.script-loader.ts` |
| Module → TaskRepoContext | `src/repo/repo-context.utils.ts` |
| Worker startup hook | `src/node/node-manager.ts` |
| Task state machine APIs | `src/task/task.api.ts` |
| Template | `tasks.example/` |
| Host root config (this repo) | `config/task.config.js` |

---

## Do not

- Add runtime TS loader (tsx/jiti) to SDK without explicit request
- Point `entry` at `.ts` files expecting native `import()` to work
- Put bootstrap status switch / verbose logging in `NodeManager` — use `runWorkerLocalTaskBootstrap`
- Reintroduce `Script extends Target` in `repo.interface.ts`
- Catch `not_configured` as an error — it is normal when using remote-only workers
- Hardcode `taskFn` in SDK source — use config discovery or `registerLocal*`
- Remove `bindTaskFn` / pass params from `executeTask` — see [Why bindTaskFn](#why-bindtaskfn-closure-bind-params); closure bind is intentional

---

## Optional: TS authoring workflow (host app, not SDK)

```json
"scripts": {
  "tasks:build": "tsc -p tasks/tsconfig.json",
  "tasks:watch": "tsc -p tasks/tsconfig.json --watch",
  "worker": "pnpm tasks:build && node run-worker.mjs"
}
```

`task.config.js` `entry` → `"./index.js"` (compiled output).

Task authors may `import type { TaskRepoContext } from "target-supabase-sdk"` in TS sources.

---

## Related skills

- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `prepareTask` propagates; worker handles empty taskFn
- [task-state-machine](../task-state-machine/SKILL.md) — `patchChangeTaskStatus`, claim, progress, Zod + locks
- [singleton-pitfalls](../singleton-pitfalls/SKILL.md) — if task runner becomes singleton-based

## Reference

- Supabase remote script category: `TASK_REPO_SCRIPT_CATEGORY` = `"script"`
- Node engines: `>=18` (native `crypto.randomUUID`, ESM dynamic import)
