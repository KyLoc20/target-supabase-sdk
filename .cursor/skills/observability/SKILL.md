---
name: observability
description: >-
  Observability roadmap and conventions for target-supabase-sdk: LogManager, traceId,
  task extra, sidecar/extension correlation, metrics. Use when implementing logging
  export, onLog hooks, cross-process tracing, task audit fields, health checks, or
  reviewing worker / auto-chrome / chrome-sidecar debuggability.
---

# Observability (target-supabase-sdk)

## One-line rule

**Every runtime path emits structured logs with `traceId`; task outcomes and cross-process RPCs must be correlatable without reading three terminals.**

---

## Current baseline (already in repo)

| Capability | Location |
|------------|----------|
| Structured log entry | `src/shared/log/log-manager.ts` — `topic`, `module`, `traceId`, `nodeId`, `context`, `extra` |
| Loop correlation | `BaseNodeRuntime` → `loopTraceId` → claim / prepare / execute / finalize |
| API traceId | Optional on `task.api`, `node.api`, `command.api`, `trigger.api` via `createLogger` |
| In-memory ring buffer | `LogManager.getHistory()` (default 4096) |
| Export hook (unused by default) | `LogManager` options `onLog?: (entry) => void` |
| Task failure context | `TaskNode.finalizeTaskRun` logs `extra`; persisted on task row |

**Gaps:** no centralized log sink, no metrics, worker ↔ sidecar ↔ extension logs not unified, `Task.details.extra` mostly unstructured string.

### LogScope / trace chain

- **`createScope`**: optional `parent` defaults `traceParentId` to `parent.traceId` and merges labels; otherwise pass `traceParentId` explicitly (e.g. task worker: `traceParentId: task.details.traceId ?? null`).
- **`topic`**: **required** on every `logger.*(message, { topic, … })` call — enforced by types and runtime; no global or logger-level default.
- **`patchScope`**: default updates `labels` / `module` only; `patch.traceId` and `patch.traceParentId` are **ignored** unless `allowTraceMutation: true`.
- **`logger.resetScope`**: `LoggerResetScopePatch` only (`module` / `labels`); trace fields cannot change — uses `patchScope` with `allowTraceMutation: false`.

---

## Implementation TODO (ordered)

Track status in this section. Mark done when shipped; do not remove items — strike or add `(done)` note.

### P0 — Low cost, high leverage (do first)

- [ ] **TODO-P0-1: Wire `onLog` JSONL export for worker**
  - On worker bootstrap (`scripts/run-node-worker.ts` or node start), configure `LogManager.getInstance({ onLog })` to append JSON Lines to e.g. `logs/worker.jsonl`.
  - One JSON object per `LogEntry`; no emoji in file sink (console formatting can stay).
  - Env: `LOG_JSONL_PATH` optional override.

- [ ] **TODO-P0-2: Propagate `traceId` across auto-chrome chain**
  - Worker / task params carry `traceId` (from `loopTraceId` or generated).
  - `ChromeWsClient` includes `meta.traceId` on each RPC (or log prefix in task).
  - `scripts/chrome-sidecar-hub.ts`: log `{ traceId, method, id, durationMs, error? }`.
  - Extension sdk-bridge: prefix `[sdk-bridge]` logs with traceId when present in hub request meta.
  - Goal: one `traceId` grep across worker + sidecar + extension.

- [ ] **TODO-P0-3: Log context field convention (skill + lint review)**
  - Document required `context` keys per `topic`:
    - `task`: `taskId`, `taskTypeKey`, `step?`
    - `node`: `nodeId`, `loopCount?`
    - `api`: handler name + business ids
  - Audit gaps in `prepareTask`, `finalizeTaskRun`, `RepoManager`, sidecar (no code change until audit list exists).

### P1 — Task audit + sidecar RPC visibility

- [ ] **TODO-P1-1: Structured `Task.details.extra` JSON schema**
  - Define versioned shape e.g. `{ v: 1, traceId, steps: [{ name, ms, ok }], error?: { step, message } }`.
  - `TaskNode.finalizeTaskRun` and task plugins (e.g. `auto-chrome.task.js`) populate on success/failure.
  - Keep backward compat: string `extra` still allowed for simple messages.

- [ ] **TODO-P1-2: Sidecar RPC audit log**
  - Every hub `request` / `response`: method, tabKey (from params), latency, error message.
  - Optional JSONL file shared path with worker (`LOG_JSONL_PATH` or `CHROME_HUB_LOG_PATH`).
  - Bridge connect/disconnect events with timestamp.

- [ ] **TODO-P1-3: auto-chrome stage steps in extra**
  - Record `prepare` / `save` / `done` / `closeTab` timings in structured extra (align with amazon page stage machine skill).

### P2 — Metrics and ops tooling

- [ ] **TODO-P2-1: In-process counters via `onLog` or thin metrics module**
  - Counters: `task_claim_total{result}`, `task_run_duration_ms{taskTypeKey}`, `heartbeat_failures_total`.
  - Gauge: sidecar `bridge_connected`.
  - Periodic INFO summary or `GET /metrics` (Prometheus text) on localhost — dev only unless secured.

- [ ] **TODO-P2-2: `pnpm observability:status` (or script)**
  - Check: sidecar listening, extension bridge hint (optional), worker registered task types, last N task outcomes from logs or Supabase.
  - Human-readable one-screen health for local dev.

- [ ] **TODO-P2-3: Dev-only debug log endpoint**
  - Optional HTTP `GET /debug/logs?traceId=&limit=` reading `LogManager.getHistory()` — gated by `NODE_ENV` / explicit flag.

### P3 — Longer term

- [ ] **TODO-P3-1: `patchTaskProgress` at long-running stages**
  - auto-chrome / scroll tasks report progress during prepare (e.g. item count).
  - Worker helper for tasks to call progress without importing full SDK surface.

- [ ] **TODO-P3-2: OpenTelemetry for Node (worker + sidecar)**
  - Spans: `claimTask` → `prepareTask` → `taskFn` → hub RPC.
  - Extension: log correlation only (full OTEL in MV3 offscreen optional later).

- [ ] **TODO-P3-3: Node heartbeat enrichment**
  - Log or persist loop duration, idle streak (N rounds no claim), `availableTaskList` snapshot on WARN.

- [ ] **TODO-P3-4: Environment-driven log filtering**
  - `LOG_LEVEL`, optional `LOG_TOPICS=task,node` wired to `LogManager.setOptions` in worker/trigger entry scripts.

---

## Design constraints (when implementing)

1. **No new throw paths in `*.api.ts`** — observability must not break [sdk-error-handling](../sdk-error-handling/SKILL.md) envelopes.
2. **Singleton LogManager** — configure via `getInstance` / `setOptions` once at process start; see [singleton-pitfalls](../singleton-pitfalls/SKILL.md).
3. **Internal imports** — observability helpers live under `src/shared/`; do not import from `src/index.ts` barrel inside `src/`.
4. **Secrets** — JSONL / debug endpoints must not log Supabase keys or full payloads with PII; redact in `onLog` if needed.
5. **Extension repo** — sidecar + traceId work spans `target-supabase-sdk` and `chrome-extension-starter`; update both skills when P0-2 ships.

---

## Related skills

- [singleton-pitfalls](../singleton-pitfalls/SKILL.md) — `LogManager.getInstance({ onLog })`
- [task-state-machine](../task-state-machine/SKILL.md) — `traceId` on task APIs
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `createLogger` in APIs
- [auto-chrome-task](../auto-chrome-task/SKILL.md) — cross-process flow (supabase-sdk)
- `chrome-extension-starter` `.cursor/skills/sdk-bridge-offscreen/SKILL.md` — bridge logs

## Reference files

| File | Role |
|------|------|
| `src/shared/log/log-manager.ts` | LogEntry, onLog, getHistory |
| `src/shared/log/log-scope.ts` | `createScope`, `patchScope`, `withModule` |
| `src/shared/log/create-logger.ts` | API-scoped loggers |
| `src/task/task-node.ts` | loopTraceId, task traceParentId, finalizeTaskRun extra |
| `src/node/node-runtime.base.ts` | startupTraceId, heartbeat |
| `scripts/chrome-sidecar-hub.ts` | Hub RPC (needs audit TODO) |
| `scripts/run-node-worker.ts` | Worker entry (wire onLog here) |
