---
name: task-local-discovery
description: >-
  Task discovery, registration, and runtime JS loading in target-supabase-sdk.
  Use when implementing or reviewing task.config.js, registerTasks, bootstrapLocalTasks,
  RepoManager, prepareTask, postTask, TaskRepoValidation, Task.value / Repo.value keys, worker availableTaskList,
  getScanRemoteRepoValues, patchClaimTask, or remote vs local script loading.
---

# Task discovery & runtime loading (target-supabase-sdk)

## Current decisions (do not change without explicit request)

1. **Runtime loads JavaScript only** — native Node ESM `import()`. Do **not** add tsx/jiti to the SDK loader by default.
2. **Config files are JS** — `config/task.config.js` and per-task `task.config.js` (native `import()`).
3. **Task authoring may use TS** — only if compiled to `.js`/`.mjs` before run; `entry` points at JS artifact.
4. **No `Script` Target subtype in `repo.interface.ts`** — script shapes live in `task-repo-context.ts` (`TaskRepoScriptRecord`, etc.).
5. **Local registration beats remote** — `RepoManager` local registry is checked before Supabase fetch at **execution** time.
6. **Single type key: `Task.value`** — equals `taskTypeKey`, `Repo.value`, local registry key, remote lookup key. **No `repoKey`**, no `TaskDetails.repo` snapshot.
7. **`Repo.details.usage`** — caller-defined string partition; task worker uses {@link TASK_REPO_USAGE} (`"task"`).
8. **`availableTaskList` is owned by `TaskManager.registerTasks` only** — no public setter on `NodeManager`; merged list = local ∪ remote; **empty → throw** (worker startup fails).

---

## Identity model

```text
Task.value  (= taskTypeKey = Repo.value)
  → patchClaimTask filter (availableTaskList)
  → RepoManager local registry key
  → remote: category=repo, value=task.value
  → remote scripts: category=script, value=task.value
```

`TaskDetails` holds `params`, `status`, `progress`, `nodeId` — **not** embedded repo metadata.

---

## Why JS at runtime (not TS)

```text
Author (TS optional) → Build → JS artifact → runtime import("./entry.js")
```

| Runtime load | Verdict |
|--------------|---------|
| **Compiled JS / `.mjs`** | ✅ Default |
| **Direct `.ts` import** | ❌ Not supported in SDK production path |
| **Inline `source` in DB** | ✅ JS string → temp `.mjs` → `import()` |

---

## Host app layout

See [config-file-relative-paths](../config-file-relative-paths/SKILL.md) for path resolution rules.

```text
<host-project>/
  config/task.config.js          ← { taskDir: "../tasks" }   (relative to config/)
  tasks/                         ← gitignored
    my-task/
      task.config.js             ← { taskTypeKey, entry: "./index.mjs" }
      index.mjs
  tasks.example/                 ← committed template
```

Legacy fallback: `./task.config.js` at project root → `{ taskDir: "./tasks" }`.

---

## End-to-end flow

```text
Host: SupabaseInitializer.initialize()   ← required before remote bootstrap

Worker start (NodeManager.runStart)
  → TaskManager.registerTasks({ logger })
       1. bootstrapLocalTasks() → RepoManager.registerLocalModule
       2. getScanRemoteRepoValues({ usage: TASK_REPO_USAGE })
       3. availableTaskList = union(local.registered, remote.values)
       4. if length === 0 → throw → NodeManager requestShutdown

postRegisterNode → main loop

patchClaimTask({ availableTaskList }) → Task

NodeManager.executeTask
  → TaskManager.prepareTask({ logger, task, includeRemote })
       → if taskTypeKey ∉ local registry → bootstrapLocalTasks({ forTaskTypeKey })
       → TaskRepoValidation.validate({ includeRemote })
            → RepoManager.getRepoContext({ taskTypeKey, includeRemote })
                 1. local registry → dynamic import(modulePath)
                 2. else if includeRemote → remote Repo row → scripts / details.url
                 3. else → LOCAL_REPO_NOT_FOUND
       → taskParamsValidator(params)
       → bindTaskFn → ExecutableTaskFn

CLI / Trigger postTask
  → TaskRepoValidation.validate({ bootstrapLocal: true, includeRemote: true })
       → same getRepoContext priority as above
```

See [target-list-query](../target-list-query/SKILL.md) for `scanTargetList` vs `getTargetList`.

---

## Worker registration (`registerTasks`)

| Step | Source | Side effect |
|------|--------|-------------|
| Local | `bootstrapLocalTasks` | Registers modules in `RepoManager` |
| Remote | `getScanRemoteRepoValues({ usage: TASK_REPO_USAGE })` | `Repo.value` where `details.usage === "task"` |
| Merge | `[...new Set([...local.registered, ...remoteValues])]` | `availableTaskList` |
| Fail-fast | merged length `=== 0` | `throw` — worker must not start idle |

```typescript
// task-node.ts — worker startup
const { availableTaskList, includeRemote } = await TaskManager.registerTasks({ logger });
this._availableTaskList = availableTaskList;
this._includeRemote = includeRemote;
```

Options: `RegisterTasksOptions` — `logger`, `local?`, `includeRemote?`.

`bootstrapLocalTasks` alone **never throws** on missing root config (`not_configured`) — but `registerTasks` **does throw** if the merged list is empty.

---

## Validation vs registration

| Concern | API | Remote? |
|---------|-----|---------|
| **Which task types can be claimed** | `registerTasks` → `availableTaskList` | `includeRemote` controls remote **discovery** for claim list |
| **Resolve one Repo + validate params** | `TaskRepoValidation.validate` / `prepareTask` / `postTask` | `includeRemote` (default `true`) controls remote **load** when local registry misses |

Both paths share `RepoManager.getRepoContext`: **local registry first**; remote only when `includeRemote: true`.

`postTask` (CLI / Trigger): `bootstrapLocal: true`, `includeRemote: true` (defaults).

`prepareTask` (Worker): no upfront `bootstrapLocal` (startup already scanned); **lazy** `bootstrapLocalTasks({ forTaskTypeKey })` when registry misses the claimed `task.value`. Passes `includeRemote` from `registerTasks` result.

### `TaskRepoValidationFailureReason` (repo load)

| Reason | Meaning |
|--------|---------|
| `LOCAL_REPO_LOAD_FAILED` | Local entry exists but module import / export invalid |
| `LOCAL_REPO_NOT_FOUND` | Not in local registry and `includeRemote: false` |
| `REMOTE_REPO_NOT_FOUND` | Supabase has no `category=repo` row for `value` |
| `REMOTE_REPO_LOAD_FAILED` | Repo row exists but scripts / `details.url` load failed |
| `PARAMS_VALIDATION_FAILED` | `taskParamsValidator` returned false or threw |
| `TASK_TYPE_KEY_MISMATCH` | `taskFn.taskTypeKey !== task.value` |
| `MISSING_PARAMS` | `params == null` |

---

## Why `bindTaskFn` (closure bind params)

`prepareTask` → `bindTaskFn` → `ExecutableTaskFn` (zero-arg). `executeTask` calls `await taskFn()` only.

Do not remove `bindTaskFn` or push param passing into `NodeManager` unless explicitly requested.

---

## Config contracts

### Root — `config/task.config.js`

```javascript
// taskDir is relative to this file's directory (config/), not project cwd
export default { taskDir: "../tasks" };
```

### Per-task — `tasks/<name>/task.config.js`

```javascript
export default {
    taskTypeKey: "my-task",   // must match Task.value / Repo.value
    entry: "./index.mjs",
    exportName: undefined,
    displayName: "My Task",
    enabled: true,
};
```

---

## API surface

| API | Role |
|-----|------|
| `TaskManager.registerTasks({ logger, ... })` | **Worker startup** — local + remote discovery → `availableTaskList`; throws if empty |
| `TaskManager.bootstrapLocalTasks(options?)` | Scan configs → `RepoManager.registerLocalModule`; fingerprint cache + single-flight |
| `TaskManager.clearBootstrapLocalTasksCache()` | Clear bootstrap fingerprint cache (tests / hot reload) |
| `TaskRepoValidation.validate({ ... })` | **Shared validation** — resolve Repo + `taskParamsValidator` |
| `TaskManager.prepareTask({ logger, task, includeRemote? })` | Worker execution prep; lazy local bootstrap on registry miss |
| `postTask` | Scheduler insert; `bootstrapLocal: true` + validation before DB write |
| `TaskManager.getRegisteredLocalTaskTypeKeys()` | Keys in local registry |
| `TASK_REPO_USAGE` | `"task"` — remote Repo `details.usage` for task worker |
| `getScanRemoteRepoValues({ usage })` | Remote `Repo.value` via `scanTargetList` + `details.usage`; returns `SupabaseResponse<string[]>` |
| `RepoManager.getRepoContext({ logger, taskTypeKey, includeRemote? })` | Load `TaskRepoContext` (local first; remote when `includeRemote`) |
| `RepoManager.hasLocalRepo(taskTypeKey)` | Whether key is in local registry (no import) |
| `RepoManager.registerLocalModule` / `registerLocalRepoContext` | Manual register (dev/tests) |

Removed: `runWorkerLocalTaskBootstrap`, `NodeManager.availableTaskList` setter.

### `bootstrapLocalTasks` status

| `status` | Meaning |
|----------|---------|
| `not_configured` | No root config — OK for remote-only if `registerTasks` still gets remote values |
| `loaded` | ≥1 task registered locally |
| `empty` | Config OK, zero local registrations |
| `failed` | Invalid config or all packages failed |
| `cached: true` on result | Scan skipped — config fingerprint unchanged |

`BootstrapLocalTasksOptions.forTaskTypeKey`: with unchanged fingerprint, skip scan only when that key is already registered.

Concurrent `bootstrapLocalTasks` calls share one in-flight scan (single-flight).

---

## RepoManager load priority (execution time)

1. **Local registry** (`registerLocalModule` / bootstrap)
2. **If `includeRemote: true`** — Supabase remote: `category=repo` where `value = taskTypeKey`
   - Script rows: `category=script`, `value = taskTypeKey`
   - Entry: `details.isEntry === true` or first row; fallback `Repo.details.url`
3. **If `includeRemote: false`** and local miss → `LOCAL_REPO_NOT_FOUND` (no Supabase fetch)

Local entry exists but import fails → `LOCAL_REPO_LOAD_FAILED` — **does not** fall back to remote.

Caches: bootstrap fingerprint; module import cache; remote context cache by `taskTypeKey@repoHash`.

---

## Types

| Type | Purpose |
|------|---------|
| `TaskRepoContext` | `{ taskParamsValidator, taskFn }` |
| `TaskFn` | `(params) => Promise<TaskRunResult>` + metadata |
| `ExecutableTaskFn` | After `bindTaskFn` — zero-arg, used by executor |
| `RegisterTasksResult` | `{ availableTaskList, local, remote, includeRemote }` |

---

## Implementation map

| Concern | File |
|---------|------|
| Config scan + bootstrap cache | `src/task/local-task-registry.ts` |
| registerTasks + prepareTask | `src/task/task-manager.ts` |
| Shared repo + params validation | `src/task/task-repo-validation.ts` |
| Remote repo values | `src/repo/repo.api.ts` |
| Full-scan primitive | `src/core.api.ts` (`scanTargetList`) |
| Local registry + remote load | `src/repo/repo-manager.ts` |
| Dynamic import | `src/repo/repo.script-loader.ts` |
| Worker startup | `src/node/node-manager.ts` |

---

## Do not

- Reintroduce `repoKey` or `TaskDetails.repo`
- Add `availableTaskList` setter on `NodeManager`
- Use `runWorkerLocalTaskBootstrap` (removed)
- Hand-roll pagination in feature APIs — use `scanTargetList`
- Catch empty merged list as success — worker must fail startup
- Use `pollTargetList` for read-only repo discovery (it deletes rows)
- Add runtime TS loader without explicit request
- Put bootstrap logging switches in `NodeManager` — `registerTasks` owns structured logs

---

## Related skills

- [config-file-relative-paths](../config-file-relative-paths/SKILL.md) — `taskDir` / `entry` path anchors
- [target-list-query](../target-list-query/SKILL.md) — `scanTargetList` / `getTargetList` layering
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — throw vs envelope at boundaries
- [task-state-machine](../task-state-machine/SKILL.md) — `patchClaimTask`, claim flow
- [singleton-pitfalls](../singleton-pitfalls/SKILL.md) — `SupabaseInitializer` before remote bootstrap
