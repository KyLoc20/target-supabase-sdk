---
name: config-file-relative-paths
description: >-
  Config-file-relative path resolution in target-supabase-sdk. Use when implementing
  or reviewing task.config.js, taskDir, entry paths, bootstrapLocalTasks, dynamic
  import of config modules, or why paths must not use process.cwd() inside config fields.
---

# Config-file-relative paths (target-supabase-sdk)

## One-line rule

**Paths written inside a config file resolve against that file's directory — not `process.cwd()`.**

Only **discovering** which config file exists uses `cwd` as anchor.

---

## Two anchors (do not mix)

| Anchor | Used for | API |
|--------|----------|-----|
| **Config file directory** | Fields inside the config (`taskDir`, `entry`, …) | `resolvePathFromConfigFile`, `resolvePathFromBaseDir` |
| **`cwd`** | Finding the root config file on disk | `resolvePathFromCwd`, `resolveFirstExistingPath` |

```text
process.cwd()  →  find config/task.config.js     (cwd anchor)
config/task.config.js  →  taskDir: "../tasks"     (config-file anchor)
tasks/weather/task.config.js  →  entry: "./index.mjs"  (config-file anchor)
```

---

## Why config-file anchor

1. **Portable** — config + relative paths move together (like `tsconfig.json` paths).
2. **Stable** — `pnpm worker` cwd does not change meaning of `./tasks`.
3. **Consistent** — root `taskDir` and per-task `entry` use the same rule.
4. **Monorepo** — multiple `config/task.config.js` each own a local `./tasks`.

**Do not** resolve `taskDir` / `entry` from `cwd` without explicit user request.

---

## Host layout (recommended)

```text
<host-project>/
  config/task.config.js     →  { taskDir: "../tasks" }
  tasks/                    →  gitignored implementations
    weather/
      task.config.js        →  { taskTypeKey, entry: "./weather.task.js" }
      weather.task.js
  tasks.example/            →  committed template
```

| Root config location | `taskDir` to reach `<root>/tasks` |
|----------------------|-----------------------------------|
| `config/task.config.js` | `"../tasks"` |
| `./task.config.js` (legacy, project root) | `"./tasks"` |

Wrong (common mistake): `config/task.config.js` + `taskDir: "./tasks"` → resolves to `config/tasks/`, not repo `tasks/`.

---

## Shared utilities (`src/shared/utils/config-path.utils.ts`)

| Function | Purpose |
|----------|---------|
| `getConfigFileDir(configFilePath)` | `dirname` of config file |
| `resolvePathFromConfigFile(configFilePath, pathInConfig)` | `taskDir` from root config |
| `resolvePathFromBaseDir(baseDir, path)` | `entry` from task package dir (same math, explicit base) |
| `resolvePathFromCwd(cwd, path)` | explicit `rootConfigPath` option |
| `resolveFirstExistingPath(cwd, { explicitPath?, candidatePaths })` | discover root config |
| `pathExists(path)` | async existence check |
| `toFileImportHref(filePath)` | `file://` URL for `import()` |
| `importJsConfigModule(configPath)` | dynamic import + `default` fallback |
| `loadCachedJsConfigModule({ path, schema, force? })` | import + validate + mtime cache |
| `getValueAtPath(value, dottedPath)` | read nested JSON field (browser-safe) |

**Reuse these** — do not duplicate `dirname` + `resolve` + `pathToFileURL` in feature modules.

### Example (bootstrap)

```typescript
const rootConfigPath = await resolveFirstExistingPath(cwd, {
  explicitPath: options.rootConfigPath,
  candidatePaths: ["config/task.config.js", "task.config.js"],
});

const { taskDir } = parseRootConfig(await importJsConfigModule(rootConfigPath), rootConfigPath);
const tasksRoot = resolvePathFromConfigFile(rootConfigPath, taskDir);

const entryPath = resolvePathFromBaseDir(taskPackageDir, taskConfig.entry);
```

---

## Absolute paths & URLs

- **Absolute filesystem paths** in config → used as-is.
- **`https://` / `file://`** in `Repo.details.url` → not config-file-relative; see `resolveRepoEntryHref` (cwd anchor for bare relative URLs in DB).

---

## Do not

- Resolve `taskDir` / `entry` from `process.cwd()` inside config field values
- Document `config/task.config.js` with `taskDir: "./tasks"` unless `tasks/` lives under `config/`
- Duplicate path helpers in `local-task-registry.ts` — import from `config-path.utils.ts`

---

## Related skills

- [task-local-discovery](../task-local-discovery/SKILL.md) — bootstrap + task packages
- [library-dev-scripts](../library-dev-scripts/SKILL.md) — worker `cwd` vs project root

## Reference

- Implementation: `src/shared/utils/config-path.utils.ts`
- Consumer: `src/task/local-task-registry.ts`, `src/repo/repo.script-loader.ts` (`toFileImportHref`)
