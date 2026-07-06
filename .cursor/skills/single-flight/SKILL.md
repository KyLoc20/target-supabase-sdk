---
name: single-flight
description: >-
  Single-flight (dedupe concurrent in-flight work) patterns in target-supabase-sdk.
  Use when implementing or reviewing start/shutdown guards, bootstrap caches,
  concurrent API calls that must share one async operation, or replacing duplicate
  listeners / double registration / parallel scans.
---

# Single-flight (target-supabase-sdk)

## One-line rule

**Concurrent callers await the same in-flight Promise — the expensive async body runs once.**

---

## When to use

| Signal | Example |
|--------|---------|
| Public `start()` / `shutdown()` / `initialize()` may be called twice | `BaseNodeRuntime.startPromise` |
| Parallel bootstrap scans race the filesystem | `bootstrapLocalTasks` |
| Side effects must not stack (listeners, DB register, main loop) | Node `registerProcessLifecycle` |
| Cache miss triggers refresh; many waiters should share one refresh | Future: catalog warm-up |

## When **not** to use

| Case | Prefer |
|------|--------|
| Every call is independent work | Plain `async` function |
| Need a fresh run after completion | New function or explicit `reset()` + document semantics |
| Mutex around sync critical section | `lock` / queue, not Promise cache |
| Singleton configuration | See [singleton-pitfalls](../singleton-pitfalls/SKILL.md) |

Single-flight ≠ singleton: it dedupes **one operation in flight**, not global identity.

---

## Two patterns in this repo

### A. Lifetime cache (process-scoped, no reset)

Operation runs **at most once per instance lifetime**. Completed Promise stays cached.

```typescript
private startPromise: Promise<void> | null = null;

async start(): Promise<void> {
    if (this.startPromise != null) {
        return this.startPromise;
    }
    this.startPromise = this.runStart();
    return this.startPromise;
}
```

| Field | Role |
|-------|------|
| `startPromise` | Blocks until main loop ends; second `start()` joins same await |
| `shutdownPromise` | Same for teardown; second `shutdown()` joins, logs debug skip |

**Reference:** `src/node/node-runtime.base.ts` — `start()` / `shutdown()`.

**Semantics to document:**
- Not a “restart” API — after `runStart()` returns, cached Promise is settled; do not expect a second full bootstrap without a new instance.
- Set `isRunning = false` **before** assigning `shutdownPromise` so the main loop can exit.

### B. In-flight only (clear in `finally`)

Concurrent callers share one scan; slot clears when done so a **later** call can run again.

```typescript
let bootstrapInFlight: Promise<Result> | null = null;

export async function bootstrap(options = {}): Promise<Result> {
    if (bootstrapInFlight != null) {
        return bootstrapInFlight;
    }
    bootstrapInFlight = runScan(options).finally(() => {
        bootstrapInFlight = null;
    });
    return bootstrapInFlight;
}
```

Combine with **fingerprint cache** to skip work when inputs unchanged (`bootstrapCache` in same file).

**Reference:** `src/task/local-task-registry.ts` — `bootstrapLocalTasks`, `clearBootstrapLocalTasksCache()`.

---

## Implementation checklist

- [ ] Guard with `if (inFlight != null) return inFlight` **before** assigning
- [ ] Assign in-flight Promise **synchronously** (no `await` between check and assign) — otherwise two callers can both pass the guard
- [ ] Choose A (lifetime) vs B (`finally` clear) and document whether re-entry is allowed
- [ ] Errors: shared Promise rejects for all waiters — usually correct; add `.catch` only when you need side effects (see `shutdownPromise`)
- [ ] Tests: `clear*Cache()` / new instance to reset B; A needs new runtime instance
- [ ] Log duplicate entry at **debug** (shutdown) or silently join (start/bootstrap) — avoid error spam

---

## Anti-patterns

```typescript
// ❌ TOCTOU — not single-flight
if (!this.running) {
    this.running = true;
    await this.runStart(); // second caller can enter before running=true visible
}

// ❌ Fire-and-forget breaks join semantics
if (this.startPromise == null) {
    void this.runStart(); // callers cannot await the same work
}

// ❌ Lifetime cache for repeatable refresh without reset API
private refreshPromise: Promise<void> | null = null; // never cleared — second refresh never runs
```

---

## Related skills

| Skill | Overlap |
|-------|---------|
| [singleton-pitfalls](../singleton-pitfalls/SKILL.md) | One instance; config once — not concurrent dedupe |
| [task-local-discovery](../task-local-discovery/SKILL.md) | `bootstrapLocalTasks` fingerprint + single-flight |
| [observability](../observability/SKILL.md) | `startPromise` blocks `run-node-worker` until shutdown |

---

## Review prompt

When reviewing a PR that adds `Promise | null` guard fields, ask:

1. Can two callers pass the guard concurrently? (sync assign fixes this)
2. Should waiters after completion start a new run? → pattern B + cache
3. Should the operation ever run twice in one process? → pattern A only if never restarted
4. Are side effects (listeners, timers, registrations) protected?
