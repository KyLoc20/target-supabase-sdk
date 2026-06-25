---
name: task-local-discovery
description: >-
  Task discovery, registration, and runtime JS loading in target-supabase-sdk.
  Use when implementing or reviewing task.config.js, registerTasks, bootstrapLocalTasks,
  RepoManager, prepareTask, Task.value / Repo.value keys, worker availableTaskList,
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
  → TaskManager.prepareTask({ logger, task })
       → task.value as taskTypeKey
       → RepoManager.getRepoContext({ taskTypeKey })
            1. local registry → dynamic import(modulePath)
            2. else remote Repo row → script rows or Repo.details.url
       → taskParamsValidator(params)
       → bindTaskFn → ExecutableTaskFn

await taskFn() → finalize success/failure
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
// node-manager.ts — only entry; no manual list, no setter
const { availableTaskList } = await TaskManager.registerTasks({ logger });
this._availableTaskList = availableTaskList;
```

Options: `RegisterTasksOptions` — `logger`, `local?`, `includeRemote?`.

`bootstrapLocalTasks` alone **never throws** on missing root config (`not_configured`) — but `registerTasks` **does throw** if the merged list is empty.

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
| `TaskManager.bootstrapLocalTasks(options?)` | Scan configs → `RepoManager.registerLocalModule`; never throws on `not_configured` |
| `TaskManager.prepareTask({ logger, task })` | Resolve context, validate params, return `ExecutableTaskFn` |
| `TaskManager.getRegisteredLocalTaskTypeKeys()` | Keys in local registry |
| `TASK_REPO_USAGE` | `"task"` — remote Repo `details.usage` for task worker |
| `getScanRemoteRepoValues({ usage })` | Remote `Repo.value` via `scanTargetList` + `details.usage`; returns `SupabaseResponse<string[]>` |
| `RepoManager.getRepoContext({ logger, taskTypeKey })` | Load `TaskRepoContext` (local first) |
| `RepoManager.registerLocalModule` / `registerLocalRepoContext` | Manual register (dev/tests) |

Removed: `runWorkerLocalTaskBootstrap`, `NodeManager.availableTaskList` setter.

### `bootstrapLocalTasks` status

| `status` | Meaning |
|----------|---------|
| `not_configured` | No root config — OK for remote-only if `registerTasks` still gets remote values |
| `loaded` | ≥1 task registered locally |
| `empty` | Config OK, zero local registrations |
| `failed` | Invalid config or all packages failed |

---

## RepoManager load priority (execution time)

1. **Local registry** (`registerLocalModule` / bootstrap)
2. **Supabase remote** — fetch `category=repo` where `value = taskTypeKey`
   - Script rows: `category=script`, `value = taskTypeKey`
   - Entry: `details.isEntry === true` or first row; fallback `Repo.details.url`

Caches: module import cache; remote context cache by `taskTypeKey@repoHash`.

---

## Types

| Type | Purpose |
|------|---------|
| `TaskRepoContext` | `{ taskParamsValidator, taskFn }` |
| `TaskFn` | `(params) => Promise<TaskRunResult>` + metadata |
| `ExecutableTaskFn` | After `bindTaskFn` — zero-arg, used by executor |
| `RegisterTasksResult` | `{ availableTaskList, local, remote }` |

---

## Implementation map

| Concern | File |
|---------|------|
| Config scan | `src/task/local-task-registry.ts` |
| registerTasks + prepareTask | `src/task/task-manager.ts` |
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
