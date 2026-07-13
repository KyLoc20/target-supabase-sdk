---
name: auto-chrome-task
description: >-
  auto-chrome task and chrome-sidecar — moved to download-service. Use when implementing
  or reviewing auto-chrome, chrome-ws-client, hub.pingBridge, or Chrome bridge issues.
  See D:/download-service/.cursor/skills/auto-chrome-task/SKILL.md for full documentation.
---

# auto-chrome task (moved)

**Implementation lives in [`download-service`](../../download-service/.cursor/skills/auto-chrome-task/SKILL.md)** (`D:/download-service`).

| Was (supabase-sdk) | Now (download-service) |
|--------------------|------------------------|
| `scripts/chrome-sidecar-hub.ts` | `src/chrome-sidecar/hub.ts` |
| `scripts/run-node-worker.ts` | `src/processes/worker.ts` + `DownloadTaskNode` |
| `tasks.example/auto-chrome/` | `tasks/auto-chrome/` |
| `pnpm post-task` | `pnpm post-task` (download-service) |
| `pnpm worker` / `pnpm chrome-sidecar` | `pnpm start` or individual process scripts |

**Scheduler:** watch-service posts `auto-chrome` tasks; download-service executes them.

Open the download-service skill for protocol, env vars, stage machine, and pitfalls.
