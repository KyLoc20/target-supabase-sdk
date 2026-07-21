---
name: extraction
description: >-
  Extraction Target in target-supabase-sdk: per-source, per-Extractor interpretation
  layer with mutable latest results. One row per (source Target id, details.loaderKey);
  value indexes the source; objects shape is defined by the Extractor. Use when
  implementing or reviewing extraction.interface.ts, Extractor plugins, postExtraction /
  patchExtractionObjects, or multimodal pipeline output into Target.
---

# Extraction (interpretation layer)

## One-line rule

**Each `(sourceTargetId, loaderKey)` maps to at most one Extraction row. `value` holds the source Target id; `details.loaderKey` names the Extractor; `objects` holds that Extractor's latest mutable analysis results — not an immutable snapshot.**

---

## Role in the Target system

```text
Source Target (Parcel, Link, Repo, …)
    │
    ├── Extraction  loaderKey = "whisper-transcript"   → objects (Extractor-defined)
    ├── Extraction  loaderKey = "scene-detect"         → objects (Extractor-defined)
    └── …
```

| Target type | Role | Extraction does NOT replace |
|-------------|------|-----------------------------|
| **Source Target** | Raw or referenced input | — |
| **Task** | In-flight process (status, progress, claim) | Task = process; Extraction = materialized interpretation |
| **Parcel** | Large binary blobs, chunks, checksum | Large payloads → Parcel ref inside objects if needed |
| **Link** | External URL reference | Link = pointer; Extraction = structured in-DB interpretation |
| **Config** | System-wide declarative config | Config = capacity/layout; Extraction = per-source analysis |

Pipeline flow (typical):

```text
Source → Task (DOING) → update Extraction.objects → Task (DONE)
```

---

## Uniqueness and indexing

| Key | Semantics |
|-----|-----------|
| `category` | `CategoryExtraction.EXTRACTION` (`"extraction"`) |
| `value` | **Source Target id** — immutable after create; primary index for "all extractions of this source" |
| `details.loaderKey` | **Extractor id** — combined with `value` forms the logical unique key |

**One source, many Extractions** — distinguished by `details.loaderKey`.

**One `(source, loaderKey)` pair, one Extraction** — no duplicate rows; updates are in-place on `objects` (and usually `meta`).

Future create API should enforce via `checkRedundancyFilterList`:

```typescript
[
  { field: "category", operator: "eq", value: CategoryExtraction.EXTRACTION },
  { field: "value", operator: "eq", value: sourceTargetId },
  { field: "details->>loaderKey", operator: "eq", value: loaderKey },
]
```

See [create-target-redundancy](../create-target-redundancy/SKILL.md). Concurrent duplicate create → `isCreateTargetAlreadyExistsError` → caller should fetch existing row and patch instead.

Query patterns:

- All interpretations for a source: filter `category` + `value = sourceId`
- One interpretation: add `details->>loaderKey = loaderKey`

---

## Field contract (`extraction.interface.ts`)

| Field | Semantics |
|-------|-----------|
| `name` | Human-readable label |
| `value` | Source Target id (any category); **not** a dedup hash or pipeline run id |
| `category` | Always `CategoryExtraction.EXTRACTION` |
| `details.manifestVersion` | Schema version (`0` today) |
| `details.loaderKey` | Extractor identifier; uniqueness with `value`; determines how to parse/render `objects` |
| `details.meta` | Extractor-owned metadata (e.g. `revision`, `updatedAt`, pipeline info); SDK keeps `unknown` at core |
| `details.objects` | Latest analysis payload — **mutable**; element shape defined by the Extractor for this `loaderKey`; SDK keeps `Array<unknown>` at core |

### `meta`

Cross-Extractor minimum when implementing patch APIs:

- `revision: number` — optimistic-lock token (see [optimistic-lock-update](../optimistic-lock-update/SKILL.md))
- `updatedAt: string` — last write timestamp

Additional fields are Extractor-specific extensions inside `meta`.

### `objects`

- Very generic at SDK boundary — **do not** add per-Extractor types to `extraction.interface.ts`
- Each **Extractor** (runtime component registered by `loaderKey`) owns:
  - Zod/schema for its `objects` shape
  - `extract(source) → objects`
  - optional UI render (similar to Link/List `loaderKey` resolution)
- Prefer Parcel refs inside `objects` for large binary/vector payloads rather than inlining megabytes in the row

---

## Lifecycle decisions (agreed)

| Topic | Decision |
|-------|----------|
| **Mutability** | `objects` is the latest interpretation — read/write in place, not append-only snapshots |
| **Source soft/hard delete** | Extraction **does not care** — no cascade, no stale mirror; orphan rows allowed |
| **History / audit** | Not stored on Extraction by default; use separate Targets (e.g. log-persist List) if needed later |
| **Concurrency** | Same `(source, loaderKey)` → `updateTargetDetails` + `optimisticLockFilterList` on `meta.revision` |

---

## Extractor vs loaderKey

Conceptual name: **Extractor**. Stored field: **`details.loaderKey`**.

```text
Extractor "whisper-transcript"
    loaderKey  →  written to Extraction.details.loaderKey
    schema     →  local to Extractor module (not core interface)
    extract()  →  produces objects[]
    parse()    →  typed view for consumers
```

Same pattern as log-persist stamping `ListDetails.loaderKey` — core SDK stores opaque payload; feature module decodes by `loaderKey`.

---

## Future API surface (not implemented yet)

When adding persistence, follow [manager-api-service](../manager-api-service/SKILL.md):

| API | Purpose |
|-----|---------|
| `postExtraction` | First materialize; redundancy filters on `(category, value, loaderKey)` |
| `getExtraction({ sourceId, loaderKey })` | Single row |
| `getExtractionList({ sourceId })` | All Extractions for a source |
| `patchExtractionObjects` | Update `objects` + bump `meta.revision` |

Get-or-create in Extractor tasks: try `postExtraction` → on already-exists → `getExtraction` → `patchExtractionObjects`.

---

## Do not

- Treat Extraction as immutable artifact rows (no supersede-by-default)
- Put source lifecycle state in Extraction when source is deleted
- Strong-type every Extractor's `objects` in `extraction.interface.ts`
- Use `value` for anything other than the source Target id
- Merge multiple Extractor results into one row without a `loaderKey` distinction

---

## Related skills

- [manager-api-service](../manager-api-service/SKILL.md) — interface / api / service layering
- [create-target-redundancy](../create-target-redundancy/SKILL.md) — `(value, loaderKey)` uniqueness on create
- [optimistic-lock-update](../optimistic-lock-update/SKILL.md) — concurrent `objects` / `meta` updates
- [task-state-machine](../task-state-machine/SKILL.md) — Task drives process; Extraction holds outcome

Source of truth for types: `src/extraction/extraction.interface.ts`.
