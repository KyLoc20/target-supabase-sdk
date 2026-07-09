---
name: trigger-local-runners
description: >-
  Local interval runners for TriggerNode in target-supabase-sdk. Use when registering
  TriggerManager.registerRunner, tick/retry/timeout semantics, TriggerNodeOptions,
  or distinguishing remote trigger.api from in-process scheduling.
---

# Trigger local runners (target-supabase-sdk)

## One-line rule

**`TriggerNode` schedules in-process runners via `TriggerManager.registerRunner`.** It does **not** scan Supabase ENABLED triggers. Remote rows stay in `trigger.api.ts` (admin/CLI only).

**Deploy one TriggerNode per logical scheduler** — multiple processes with the same runners will duplicate work.

---

## Architecture

```text
scripts/run-trigger-node.ts
  initSupabaseFromEnv()
  TriggerManager.registerRunner() × N   ← before start() only
  new TriggerNode({ requireRunners: true }).start()
       → closeRegistration()
       → BaseNodeRuntime loop (60s)
            → TriggerManager.tick(ctx)
                 → Promise.all(due runners)
```

| Module | Role |
|--------|------|
| `trigger-manager.ts` | Registry, `tick`, retry/timeout execution |
| `trigger-node.ts` | Bootstrap, heartbeat gate, `requireRunners` |
| `trigger.api.ts` | **Not used by TriggerNode** |

---

## Register a runner (code only)

```typescript
import {
  TriggerManager,
  TriggerNode,
  LOG_TOPIC_TRIGGER,
  postTask,
} from "target-supabase-sdk/node";

// Same-process scheduler with local taskDir — use postTaskWithValidation instead.

TriggerManager.registerRunner({
  key: "post-weather-task",
  intervalMs: 24 * 60 * 60 * 1000,
  initialDelayMs: 0,
  retryCount: 3,
  retryDelayMs: 5_000,
  timeoutMs: 120_000,
  fn: async (ctx) => {
    const { error } = await postTask({ ... });
    if (error) throw new Error(error.message);
    ctx.logger.success("posted", { topic: LOG_TOPIC_TRIGGER });
  },
});

await new TriggerNode({ requireRunners: true }).start();
```

### `RegisterTriggerRunnerOptions`

| Field | Default | Notes |
|-------|---------|-------|
| `key` | — | Trimmed, non-empty, unique |
| `intervalMs` | — | Min spacing; effective precision ≥ `TRIGGER_LOOP_INTERVAL_MS` (60s) |
| `fn` | — | `TriggerRunnerContext` |
| `initialDelayMs` | `0` | Delay first run |
| `retryCount` | `3` | Extra attempts after first failure **per tick** |
| `retryDelayMs` | `0` | Pause between attempts in same tick |
| `timeoutMs` | none | Per-attempt wall clock; does **not** cancel in-flight fn |

### Registry API

| Method | Purpose |
|--------|---------|
| `registerRunner` | Add runner (before `start()` only) |
| `hasRunner(key)` | Exists after trim |
| `unregisterRunner(key)` | Remove; throws if `running` |
| `getRunnerKeys()` | List keys |
| `clearRunners()` | Tests; throws if any `running` |
| `closeRegistration()` | Called by TriggerNode bootstrap |

---

## `TriggerNodeOptions`

| Field | Default | Notes |
|-------|---------|-------|
| `requireRunners` | `false` | `true` → throw if zero runners at bootstrap |

---

## Timing & failure semantics

### Main loop

Fixed **60s** (`TRIGGER_LOOP_INTERVAL_MS`). Runners with `intervalMs < 60_000` are warned at bootstrap.

### `nextRunAt`

Set in `finally` after each tick: `Date.now() + intervalMs` — always, success or exhausted retries.

### Retries

Up to `1 + retryCount` attempts per tick. `retryDelayMs` between failures. Then wait until next interval.

### Overlap / backlog

If `fn` still running when due → **skip** tick (`running` guard). No catch-up. Risk grows if `fn` duration or `timeoutMs` approaches `intervalMs`.

### Hang / timeout

`timeoutMs` rejects the **await** — underlying `fn` may keep running (no `AbortSignal` yet). Prefer bounded IO inside `fn` or set `timeoutMs` below `intervalMs`.

### Heartbeat

When heartbeat fails, the whole runner tick round is skipped (~60s per failure).

### Round logging

All due runners failed → `warn` with `runnerKeys`. Any success → `info` with `due` / `executed`.

---

## Operations

| Concern | Guidance |
|---------|----------|
| Zero runners | Warn + idle loop; use `requireRunners: true` in production |
| Multi-instance | One process per scheduler deployment |
| `clearRunners` in tests | Wait for ticks to finish |
| Registration after `start` | Throws — register before `start()` |

---

## Do not

- Call `scanEnabledTriggers` from `TriggerNode`
- Run duplicate TriggerNode fleets with the same side effects
- `unregisterRunner` while runner is `running`

---

## Related skills

- [browser-node-exports](../browser-node-exports/SKILL.md)
- [supabase-holder](../supabase-holder/SKILL.md)
- [library-dev-scripts](../library-dev-scripts/SKILL.md)

## Reference

- `src/trigger/trigger-manager.ts`
- `src/trigger/trigger-node.ts`
- `scripts/run-trigger-node.ts`
