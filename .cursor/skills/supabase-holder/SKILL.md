---
name: supabase-holder
description: >-
  Single supabase holder in target-supabase-sdk. Use when accessing supabase.client,
  bootstrap initialize(), reviewing core.api or *-manager imports, or adding DB access —
  import { supabase } from "./supabase"; class SupabaseInitializer is module-private.
---

# Supabase single holder (target-supabase-sdk)

## One-line rule

**`export const supabase` lives only in `src/supabase.ts`.** `SupabaseInitializer` is a **module-private** class — not part of the public API. Import `supabase` (value) or `SupabaseHolder` (type).

---

## Architecture

```text
src/supabase.ts
  ├── class SupabaseInitializer     (module-private — not exported)
  └── export const supabase         ← single public holder
      export type SupabaseHolder = typeof supabase

src/core.api.ts, *-manager.ts   → import { supabase } from "./supabase" | "../supabase"
src/browser.ts                   → export { supabase }; export type { SupabaseHolder, SupabaseInitializerParams }
src/node.ts                      → export * from "./browser"
scripts/init-supabase.ts         → import { supabase } from "../src/supabase.js"
```

| Layer | Import | Configure |
|-------|--------|-----------|
| **Holder** | `src/supabase.ts` creates `supabase` once | — |
| **Core / managers** | `import { supabase } from "../supabase"` | Use `supabase.client` after init |
| **App / scripts** | `import { supabase } from "target-supabase-sdk"` or leaf path | `await supabase.initialize(params)` |
| **Tests** | `import { supabase } from "./supabase"` | `supabase.reset()` then `initialize()` |

Public types: `SupabaseHolder`, `SupabaseInitializerParams`. Do **not** import `SupabaseInitializer` — it is not exported.

---

## Do / don't

### Do

```typescript
import { supabase, type SupabaseHolder, type SupabaseInitializerParams } from "target-supabase-sdk";

await supabase.initialize({ supabaseUrl, supabaseAnonKey });
supabase.client.from("target").select();
```

### Don't

```typescript
// ❌ Class not in public API (removed)
import { SupabaseInitializer } from "target-supabase-sdk";

// ❌ Barrel round-trip inside src/
import { supabase } from ".";
import { supabase } from "./browser";
```

---

## Lifecycle

| Phase | API | Notes |
|-------|-----|-------|
| Holder exists | `import { supabase }` | Cheap; no network until `initialize()` |
| Configure | `await supabase.initialize(params)` | First call wins; second is no-op + dev log |
| Use | `supabase.client` / `supabase.authClient` | Throws if not initialized |
| Tests | `supabase.reset()` | Then `initialize()` again |

See [singleton-pitfalls](../singleton-pitfalls/SKILL.md).

---

## Public API / breaking change

| Removed from package export | Replacement |
|----------------------------|-------------|
| `SupabaseInitializer` (class) | `supabase` holder |
| `SupabaseInitializer.getInstance()` | `import { supabase }` |

`import { supabase }` unchanged. Type annotations: `SupabaseHolder` or `typeof supabase`.

---

## Import cycles

```typescript
import { supabase } from "./supabase";      // core.api
import { supabase } from "../supabase";     // repo-manager
```

Never import `supabase` from `browser.ts` or barrel **inside** `src/`. See [barrel-import-cycles](../barrel-import-cycles/SKILL.md).

---

## Review checklist

- [ ] New code uses `import { supabase }` only?
- [ ] No `SupabaseInitializer` import (class is private)?
- [ ] No barrel round-trip for `supabase` in `src/`?
- [ ] Bootstrap calls `initialize()` before `supabase.client`?

---

## Related skills

- [singleton-pitfalls](../singleton-pitfalls/SKILL.md)
- [barrel-import-cycles](../barrel-import-cycles/SKILL.md)
- [library-dev-scripts](../library-dev-scripts/SKILL.md)

## Reference files

| File | Role |
|------|------|
| `src/supabase.ts` | Private class + `export const supabase` + `SupabaseHolder` |
| `src/browser.ts` | Public re-export |
| `scripts/init-supabase.ts` | Env bootstrap |
