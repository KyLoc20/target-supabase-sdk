---
name: barrel-import-cycles
description: >-
  ESM circular-import and TDZ pitfalls in target-supabase-sdk. Use when reviewing
  src/**/*.api.ts, index.ts barrel exports, import { supabase } from "." or "..",
  module-level Zod schemas, ReferenceError before initialization, or adding core.api
  constants used at module load time.
---

# Barrel import cycles (target-supabase-sdk)

## One-line rule

**Implementation modules under `src/` never import from `index.ts` (`"."` / `".."`). Import leaf modules directly (`./supabase`, `../core.api`).**

`index.ts` is for **package consumers only**.

---

## What broke (real incident)

```
node-manager → command.api → core.api → index.ts → core.api (unfinished)
```

`command.api.ts` evaluated Zod at module load:

```typescript
size: z.number().int().min(1).max(MAX_POLL_TARGET_LIST_SIZE).optional(),
```

`core.api.ts` had suspended on `import { supabase } from "."` before `MAX_POLL_TARGET_LIST_SIZE` was assigned → **TDZ**:

`ReferenceError: Cannot access 'MAX_POLL_TARGET_LIST_SIZE' before initialization`

**Fix:** `core.api.ts` uses `import { supabase } from "./supabase"`, not the barrel.

---

## Audit (this repo)

| File | Pattern | Status |
|------|---------|--------|
| `core.api.ts` | was `import { supabase } from "."` | ✅ fixed → `./supabase` |
| `auth/auth.api.ts` | was `import { supabase } from ".."` | ✅ fixed → `../supabase` |
| `command/command.api.ts` | module-level Zod + `MAX_POLL_TARGET_LIST_SIZE` from `core.api` | ✅ safe after core fix |
| Other `*.api.ts` | `from "../core.api"` (functions only) | ✅ OK — bindings read at call time |
| `repo-manager.ts` | `import { supabase } from "../supabase"` | ✅ reference pattern |

**Only `command.api.ts`** uses a `core.api` **const** at module top level in Zod. Others import functions/types used inside async handlers or `validateWithSchema` wrappers.

---

## Safe import graph

```text
index.ts          → re-exports only (consumers)
core.api.ts       → ./supabase, ./core.interface, ./core.utils
*.api.ts          → ../core.api, ../core.interface, ../supabase (never index)
*-manager.ts      → same as *.api.ts
```

Forbidden inside `src/`:

```typescript
import { supabase } from ".";   // core.api — caused cycle
import { supabase } from "..";  // auth.api — same smell
import { foo } from "../index";
```

Allowed for **consumers** (apps, scripts importing the package):

```typescript
import { supabase, TaskManager } from "target-supabase-sdk";
```

---

## Supabase access pattern

Single holder in `src/supabase.ts`:

```typescript
import { supabase } from "../supabase";
// supabase.client / supabase.authClient — after initialize()
```

Do **not** import module-private `SupabaseInitializer`. Do **not** re-export `supabase` from a feature module via barrel round-trip.

See [supabase-holder](../supabase-holder/SKILL.md).

---

## Module-level Zod + imported constants

High risk when the constant’s module can circularly depend on `index.ts`:

| Risk | Mitigation |
|------|------------|
| `z.max(IMPORTED_CONST)` at top level | Keep `core.api` free of barrel imports (required) |
| Shared cap across apis | Prefer `MAX_*` in `core.api` + direct `../core.api` import |
| Still fragile | Inline literal, or `core.constants.ts` (no supabase/index imports), or lazy `() => z.object(...)` |

Review checklist for new schema:

- [ ] Constant imported from module that imports `index`?
- [ ] Schema evaluated at import time (top-level `z.object`)?
- [ ] If both yes → break cycle or move constant to leaf file

---

## How to detect

```bash
# Barrel imports from implementation code
rg "from [\"']\\.\\.?[\"']" src/

# Should return nothing (except comments/docs)
```

Runtime: `ReferenceError: Cannot access 'X' before initialization` at a `const` used in another module’s top-level code → trace import chain for `index.ts` loop.

---

## Review checklist (new / changed module)

- [ ] No `from "."` or `from ".."` in `src/**/*.ts` (except package boundary tests)
- [ ] `core.api.ts` imports only leaf modules (`./supabase`, not barrel)
- [ ] Module-level Zod does not read `core.api` exports unless core is cycle-free
- [ ] New `export *` in `index.ts` does not create `index → child → index` via barrel import in child

---

## Related skills

- [library-exports](../library-exports/SKILL.md) — `index.ts` is public aggregate only
- [supabase-holder](../supabase-holder/SKILL.md) — `import { supabase } from "./supabase"`
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — `*.api.ts` layer boundaries

## Reference files

| File | Role |
|------|------|
| `src/index.ts` | Root barrel — do not import from inside `src/` |
| `src/core.api.ts` | `MAX_POLL_TARGET_LIST_SIZE`, `import { supabase } from "./supabase"` |
| `src/command/command.api.ts` | Module-level Zod using core constant |
| `src/auth/auth.api.ts` | Auth + supabase (fixed barrel import) |
