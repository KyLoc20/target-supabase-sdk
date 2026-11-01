---
name: task-query-api
description: L3 services must read Task rows only via task-query.api (countTasks, hasActiveTasks, listTasks, taskStatusFilter*). No raw details.status or ad-hoc getTargetList/scanTargetList for task admin/scheduler gates unless SDK gap.
---

# Task 访问（L3）

Task lifecycle lives in **`target.status`**, not `details.status`. State transitions stay on **`patchChangeTaskStatus` / TaskNode** — do not `updateTarget` status from L3.

## Allowed read API (`target-supabase-sdk`)

| Need | API |
|------|-----|
| Count by type + status | `countTasks({ value?, valueIn?, status?, statusIn? })` — **observability queue depth** |
| Scheduler gate (any open TODO/DOING) | `hasActiveTasks({ value?, valueIn?, statuses? })` |
| Admin / UI lists | `listTasks({ value?, valueIn?, status?, limit?, orderBy? })` |
| Build filters (gc buckets, custom scan) | `taskStatusFilterEq`, `taskStatusFilterIn`, `buildTaskQueryFilters`, export **`TASK_STATUS_FIELD`** (`"status"`) |
| Stable list DTO fields | `TaskSummary` + `taskToSummary(task)` |

## Forbidden in L3 (Task category)

- `details.status`, `details->>status` filters
- `scanTargetList({ category: task, maxRows: 500 })` then filter in memory for counts or lists
- Local `const TASK_STATUS_FIELD = "status"` — import **`TASK_STATUS_FIELD`** from the SDK instead

## PR checklist

- [ ] No new direct `getTargetList` / `scanTargetList` on `CategoryTask.TASK` unless documented SDK gap
- [ ] Scheduler “skip post if open task” uses **`hasActiveTasks`**
- [ ] Observability queue depth uses **`countTasks`**, not full task scans
- [ ] List handlers use **`listTasks`** (HTTP response shape unchanged)
- [ ] Tests or manual check: same `type` / `status` / `limit` → same task **id** set as before migration (where prior behavior was filter-first)
