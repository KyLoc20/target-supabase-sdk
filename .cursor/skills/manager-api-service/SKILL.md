---
name: manager-api-service
description: >-
  Three-layer domain pattern for target-supabase-sdk: Manager (domain logic),
  API (Supabase persistence), Service (workflow orchestration). Use when adding
  or reviewing domain modules, deciding where code belongs, naming *Manager,
  post*/get*/delete* APIs, or one-shot publish/restore flows (e.g. Parcel).
---

# Manager · API · Service

## Layers

```text
interface.ts   — types, enums, Target subtype shapes
manager.ts     — domain logic, no Supabase, no CLI I/O
*.api.ts       — CRUD on `target` table (Zod + createTarget/getTarget/…)
*.service.ts   — multi-step workflows composing Manager + API
scripts/ CLI   — env, filesystem, logging; call Service (or Manager+API directly for minimal tools)
```

| Layer | Owns | Must NOT |
|-------|------|----------|
| **Manager** | Algorithms, crypto, adapters, in-memory domain objects | Import `core.api`, `supabase`, or `*.api.ts` |
| **API** | Validation schemas, category filters, single persistence ops | Orchestrate uploads/splits or multi-step business flows |
| **Service** | End-to-end use cases (`publishX`, `restoreXById`) | Replace Manager primitives when caller needs fine control |

## Dependency direction

```text
interface  ←  manager  ←  service  →  api  →  core.api
```

- **API may import Manager types** (e.g. `ParcelDetails` in Zod schemas).
- **Service imports Manager + API**; never the reverse.
- **Manager stays runnable offline** (browser-safe when using Web APIs only).

## When to add each piece

| Need | Where |
|------|--------|
| New field on Target row | `*.interface.ts` + API schema |
| Split/encrypt/upload/reassemble | Manager method |
| Insert/select/delete one row | `post*` / `get*` / `delete*` / `patch*` in `*.api.ts` |
| Same 3+ step sequence in 2+ callers | `*.service.ts` |
| `.env`, `readFile`, `writeFile` | `scripts/` only |

## API conventions

- Name: `postDomain`, `getDomain`, `deleteDomain`, `patchDomain…`
- Wrap with `validateWithSchema(schema, "schemaName")`
- Set `category` in `createFn`; filter `category` on read/delete
- DB failures: `handleSupabaseError` throws — success responses use `generateResponse.success`; check `data`, not optional `error` on happy path

## Service conventions

- Name workflows by user intent: `publishParcel`, `restoreParcelById`
- Accept plain input objects; return domain result + side-effect hints (e.g. generated `CryptoKey`)
- Thin: delegate logic to Manager; one API call per persistence step unless transaction/RPC exists

## Manager naming

**`*Manager` is the project convention** for a namespace of domain operations (not necessarily a singleton).

| OK | Prefer when |
|----|-------------|
| `ParcelManager.create / save / reassemble` | Name matches existing `TaskManager`, `LogManager` family |
| Plain object export `{ create, save, reassemble }` | No hidden global state; functions are stateless |

**Method names** — prefer **verb = outcome** over generic CRUD:

| Current (Parcel) | Clearer alias (optional future rename) | Meaning |
|------------------|----------------------------------------|---------|
| `create` | `split` or `prepare` | Build chunks + manifest (no upload) |
| `save` | `upload` or `distribute` | Push chunks via `StorageAdapter[]` |
| `reassemble` | Fetch chunks → merge → optional decrypt |

**Do not** rename Manager to `Service` — Service is the orchestration layer above Manager.

## TargetDraft

`TargetDraft<T> = Omit<T, "id" | "created_at">` (`core.interface.ts`) — in-memory Target before DB insert.

| Type | Layer | Role |
|------|-------|------|
| `TargetDraft<Parcel>` | Manager (`save` return) | Chunks uploaded; ready for `postParcel` |
| `PostParcelPayload` / `PostTargetPayload` | API | Zod-validated request body |
| `Parcel` / `Target` | After `post*` / `get*` | Persisted row with `id`, `created_at` |

Do not reintroduce per-domain `*Draft` type aliases when `TargetDraft<T>` suffices. For `link` / `list` draft **assembly** (convenience inputs → `TargetDraft`), use `*.build.ts` — see [target-draft-build](../target-draft-build/SKILL.md).

## Reference: Parcel

```text
publishParcel
  → ParcelManager.create(file, options)
  → ParcelManager.save(result, adapters, { name, value })  → TargetDraft<Parcel>
  → postParcel({ name, value, details, … })

restoreParcelById
  → getParcel({ id })
  → ParcelManager.reassemble(parcel, options)

restoreParcel(parcel)     — in-memory Parcel from getParcel; no local manifest files
```

CLI `parcel:split` / `parcel:restore` call **Service** + **getParcel**; chunk/key files are storage sidecars only (no `*.parcel.manifest.json`).

## Checklist (new domain)

- [ ] `*.interface.ts` — Target subtype + `CategoryX` enum
- [ ] `*-manager.ts` — pure logic, exported as const object or class without Supabase
- [ ] `*.api.ts` — post/get/delete (+ patch if needed)
- [ ] `*.service.ts` — only if ≥2 callers need the same workflow
- [ ] `browser.ts` — export Manager + API + Service + types; Node-only pieces stay on `/node` entry
- [ ] Manager does **not** import `*.api.ts`

## Anti-patterns

- Putting `createTarget` inside Manager → couples crypto/split to DB; breaks offline/browser-only use
- Fat API that uploads files → belongs in Manager + Service
- Service reimplementing checksum/crypto → call Manager
- Singleton `getInstance()` on stateless Manager → unnecessary; use module exports unless options/lifecycle required (see `singleton-pitfalls` skill)
