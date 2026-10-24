---
name: task-archive
description: >-
  Task archival protocol: category task → task.archived via updateTargetCategory;
  retention rules on details.status and created_at (UTC); independent from gc-task
  stale reset/delete. Use when implementing archive-task runner, reviewing claim scans,
  or cold-storage queries on task.archived rows.
---

# Task archive protocol

## Category

| `category` | Meaning |
|------------|---------|
| `task` (`CategoryTask.TASK`) | Active queue — worker claim, stale GC scans, overview counts |
| `task.archived` (`CategoryTask.TASK_ARCHIVED`) | Cold row — same `details` / `name` / `value`; **not** claimed or listed as active Task |

Move rows with SDK **`updateTargetCategory`** only (restricted API in `core.api.ts`). Do not use `updateTarget` / `patchTarget` for category changes.

## Retention (`shouldArchiveTask`)

Age is **`created_at`** compared in **UTC** (ISO / timestamptz — no local timezone adjustment).

| Condition | Archive |
|-----------|---------|
| `details.status === CLOSED` and age ≥ **14 days** | Yes |
| `details.status ∈ { OPEN, TODO, DONE }` and age ≥ **28 days** | Yes |
| `details.status === DOING` | **Never** (any age) |
| `details.status === DONE` before **28 days** | No |

Independent from **`gc-task`** / `classify-stale-tasks` (scoped reset OPEN + delete stale OPEN).

## Execution (gc-service)

- **Runner**: `runners/schedule/archive-task` — daily tick, runs archive job in-process (no worker Task).
- **CLI**: `pnpm archive-task` (`scripts/archive-task.ts`), optional `--dry-run`.
- **Scan**: two buckets — `CLOSED` + `created_at < cutoff14`; `OPEN|TODO|DONE` + `created_at < cutoff28`; paginate via `getTargetList` + `filterBuilder.lt("created_at", iso)`.
- **Write**: re-fetch or use scan row → `shouldArchiveTask` → `updateTargetCategory` with locks `category=task` + `details->>status`.
- **Report**: counts grouped by archived `TaskStatus`.

## Read paths after archive

- **Excluded**: `patchClaimTask`, `scanTargetList` / counts with `category: task`, gc stale-task scans.
- **Still valid**: `getTarget({ id })` for audit by PK.

## Related

- [task-state-machine](../task-state-machine/SKILL.md) — active Task transitions
- [target-list-query](../target-list-query/SKILL.md) — list scan + `filterBuilder`
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — UPDATE WHERE locks
