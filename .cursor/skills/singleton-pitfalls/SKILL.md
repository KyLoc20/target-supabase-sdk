---
name: singleton-pitfalls
description: >-
  Pitfalls and safe patterns for singleton getInstance() in target-supabase-sdk
  (LogManager, SupabaseInitializer). Use when implementing or reviewing singletons,
  constructor/options on getInstance, module-level eager init, setOptions, or tests.
---

# Singleton pitfalls (target-supabase-sdk)

## Rule

**`getInstance(...)` only constructs once.** Anything passed on later calls is ignored unless the API explicitly warns or reroutes to another method.

Design singletons so configuration cannot **silently fail**.

---

## Problem 1: Second `getInstance(options)` is ignored (silent failure)

### What happens

```typescript
// Typical broken pattern
static getInstance(options?: Options): Foo {
  if (!Foo.instance) {
    Foo.instance = new Foo(options);  // options used ONCE
  }
  return Foo.instance;
}
```

| Call order | Caller expectation | Reality |
|------------|-------------------|---------|
| 1st `getInstance({ minLevel: DEBUG })` | Configure logger | ✅ Applied |
| 2nd `getInstance({ minLevel: ERROR })` | Reconfigure logger | ❌ **Ignored** — still DEBUG |

The TypeScript signature suggests every call can pass `options`; that is misleading for a singleton.

### Real failure scenario (LogManager)

```typescript
// src/log/log-manager.ts — module eager init runs first
const logger = LogManager.getInstance();  // default options, no args

// App bootstrap — thinks it can configure here
LogManager.getInstance({ minLevel: LogLevel.DEBUG, onLog: sendToSupabase });
// ↑ Nothing changes unless you warn or use setOptions()
```

**Module load order decides config**, not the caller’s “obvious” bootstrap code.

### Fix pattern

1. **Warn** when `getInstance(options)` is called after instance exists and `options` is non-empty
2. Expose **`setOptions(partial)`** (merge, never mutate shared defaults) for post-create updates
3. Or remove `options` from `getInstance` signature entirely — only allow options on first bootstrap via explicit `createLogger()` / `initialize()`

Reference: `src/log/log-manager.ts` — `getInstance` + `setOptions` + `mergeLogOptions()`.

---

## Problem 2: Eager module-level singleton freezes config

```typescript
// Bottom of log-manager.ts
export const logManager = LogManager.getInstance();
```

Any import of `{ logManager }` **creates the singleton** before app entry can pass options.

| Who wins | When |
|----------|------|
| First importer of `log-manager` | Instantiates singleton with defaults |
| Later bootstrap code | Too late for `getInstance(options)` |

### Mitigations

- Lazy init: export `getLogger()` instead of eager `const logger = getInstance()`
- Document: “Call `setOptions()` in app entry before other modules log”
- Or defer default export until after explicit `initLogManager(options)` (breaking change)

Same class of issue: `src/supabase.ts` exports `supabase = SupabaseInitializer.getInstance()` — holder exists on first import of `./supabase`; clients are cheap until `initialize()`.

See [supabase-holder](../supabase-holder/SKILL.md) — do not duplicate `getInstance()` in feature modules.

---

## Problem 3: Shared default options object mutation

```typescript
// BAD
this.options = options ?? DEFAULT_OPTIONS;
// later: this.options.minLevel = X  → mutates DEFAULT_OPTIONS for everyone
```

### Fix

Always merge into a **new object**:

```typescript
function mergeOptions(partial?: Partial<Options>): Options {
  return { ...DEFAULT_OPTIONS, ...partial };
}
```

Reference: `mergeLogOptions()` in `src/log/log-manager.ts`.

---

## Problem 4: Init-once vs re-init (SupabaseInitializer)

`SupabaseInitializer` separates **construction** from **configuration**:

| Phase | Method | Second call behavior |
|-------|--------|---------------------|
| Construct singleton | `getInstance()` | Returns same instance |
| Configure clients | `initialize(params)` | **No-op** with log — returns existing clients |
| Reset (tests) | `reset()` | Clears clients; must `initialize()` again |

```typescript
if (this.isInitialized) {
  logDev("🚫 Supabase already initialized");
  return { supabase: this._mainClient!, supabaseAuth: this._authClient };
}
```

Unlike LogManager (no log on ignored options before fix), Supabase at least **logs** duplicate init. Still a footgun if the second caller expects different URL/keys.

### Test / multi-env guidance

- Use `reset()` between tests
- Do not call `initialize()` twice with different params expecting a switch — call `reset()` first

Reference: `src/supabase.ts`.

---

## Problem 5: Testing and mocking

Singletons resist isolated tests:

| Issue | Symptom |
|-------|---------|
| Global state | Test A’s `setOptions` / history affects Test B |
| No factory | Cannot inject fake `onLog` without touching real instance |
| Import side effects | `import { logManager } from "./log-manager"` locks defaults |

### Mitigations

- Export class (`LogManager`) or holder (`supabase`) for tests + document `reset()` / `clearHistory()`
- Prefer `createX(options)` factory when testability matters more than global convenience
- In tests: call `reset()` / `clearHistory()` / `setOptions(defaults)` in `beforeEach`

---

## Problem 6: Hidden coupling via import order

```text
index.ts imports supabase singleton
  → node-manager imports logger + supabase
    → both singletons exist before main() runs
```

Debugging “why is my config wrong?” often traces to **who imported first**, not who called `getInstance(options)` last.

### When reviewing new singletons

- [ ] Is `options` on `getInstance` only honored once? Warn or document?
- [ ] Is there post-create `setOptions` / `initialize` / `reset`?
- [ ] Are defaults copied (`{ ...DEFAULT }`), not referenced?
- [ ] Is there eager `const x = getInstance()` at module bottom?
- [ ] Can tests reset state?

---

## SDK singleton inventory

| Class | File | Config entry | Post-create update | Reset |
|-------|------|--------------|--------------------|-------|
| `LogManager` | `src/log/log-manager.ts` | 1st `getInstance(partial?)` | `setOptions(partial)` | `clearHistory()` |
| `supabase` holder | `src/supabase.ts` | `initialize(params)` | ❌ (re-init ignored) | `reset()` on holder |

`SupabaseInitializer` class is module-private — see [supabase-holder](../supabase-holder/SKILL.md).

---

## Recommended patterns for new code

### Prefer when global state is needed

```typescript
class Foo {
  private static instance: Foo;

  static getInstance(): Foo { /* no options param */ }

  configure(options: Partial<FooOptions>): void {
    this.options = mergeDefaults(this.options, options);
  }

  static resetForTests(): void {
    Foo.instance = undefined as unknown as Foo;
  }
}
```

### Prefer when testability matters

```typescript
export function createLogger(options?: Partial<LogOptions>): LogManager {
  return new LogManager(options);
}
```

Use singleton default export only at app boundary, not inside library modules that other features import.

---

## Do not

- Assume `getInstance(differentOptions)` updates an existing singleton
- Share `DEFAULT_OPTIONS` by reference without spread merge
- Add `options?` to `getInstance` without warn, docs, or `setOptions` escape hatch
- Reset singleton state in production code without documenting race risk

---

## Reference

- Fixed example: `src/log/log-manager.ts` — warn + `setOptions` + `mergeLogOptions`
- Init-once example: `src/supabase.ts` — `initialize()` guard + `reset()`
- Eager export: `src/supabase.ts` — `export const supabase`; `src/browser.ts` re-exports
