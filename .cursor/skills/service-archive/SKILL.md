---
name: service-archive
description: >-
  Service instance cold storage: category service → service.archived via
  updateTargetCategory. gc-service implements eligibility in gc-stale-service.
  Use when reviewing registry rows vs archived instances.
---

# Service archive protocol

## Category

| `category` | Meaning |
|------------|---------|
| `service` (`CategoryService.SERVICE`) | Active instance — registry slots, guard runtime |
| `service.archived` (`CategoryService.SERVICE_ARCHIVED`) | Cold row — same `details`; excluded from active service scans |

Move rows with **`updateTargetCategory`** and optimistic locks on `category=service` (and lifecycle status when needed).

## gc-service eligibility (`gc-stale-service`)

Age uses **`created_at`** (UTC). Runtime heartbeat: **`details.runtime.lastHeartBeat`**.

Archive when **any** holds:

1. `details.lifecycle.status !== ACTIVE` and age ≥ **7 days**
2. Valid runtime heartbeat stale ≥ **7 days** and row age ≥ **14 days** (including `ACTIVE`)
3. Missing/invalid runtime heartbeat and row age ≥ **21 days**

## Related

- [task-archive](../task-archive/SKILL.md) — `task.archived`
- Node cold storage: `CategoryNode.NODE_ARCHIVED` (`node.archived`) — gc-service `gc-stale-node`
