---
name: task-archive
description: >-
  Task cold storage: category task → task.archived via updateTargetCategory.
  Production retention for gc-service is implemented by gc-stale-task (reset +
  archive). Use when reviewing claim scans, archived row queries, or category moves.
---

# Task archive protocol

## Category

| `category` | Meaning |
|------------|---------|
| `task` (`CategoryTask.TASK`) | Active queue — worker claim, stale scans, overview counts |
| `task.archived` (`CategoryTask.TASK_ARCHIVED`) | Cold row — same `details` / `name` / `value`; **not** claimed or listed as active Task |

Move rows with SDK **`updateTargetCategory`** only (restricted API in `core.api.ts`). Do not use `updateTarget` / `patchTarget` for category changes.

## gc-service retention (`gc-stale-task`)

Implemented in **`gc-service`** `src/lib/gc-stale/` (classifiers + `runGcStaleTaskJob`). Age is **`created_at`** in UTC.

| Condition | Action |
|-----------|--------|
| `TODO` and age ≥ **3 days** | RESET → OPEN; merge `extra.gcStale` |
| `DOING` and age ≥ **48h** | RESET → OPEN (requires `nodeId`); merge `extra.gcStale` |
| `OPEN` and age ≥ **28 days** | merge `extra.gcStale` → `task.archived` |
| `DONE` / `CLOSED` and age ≥ **28 days** | `task.archived` (no extra write) |
| `DOING` before **48h** | No archive |

Schedule: **`scan-stale`** posts worker task **`gc-stale-task`** every **12h** (scan + writes run in the worker).

CLI: `pnpm gc-stale-task` (`scripts/gc-stale-task.ts`), optional `--dry-run`.

## Read paths after archive

- **Excluded**: `patchClaimTask`, `scanTargetList` / counts with `category: task`, gc-stale-task scans.
- **Still valid**: `getTarget({ id })` for audit by PK.

## Related

- [task-state-machine](../task-state-machine/SKILL.md) — active Task transitions
- [target-list-query](../target-list-query/SKILL.md) — list scan + `filterBuilder`
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — UPDATE WHERE locks
