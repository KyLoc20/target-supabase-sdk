---
name: media-link
description: >-
  Media convention on Link (value/loaderKey video|audio|image|image-list) in
  target-supabase-sdk: MediaOriginal, buildMediaLinkDraft, registerMediaLink,
  LOCAL_STORAGE_PROVIDER availability. Use when registering or querying media
  Links, replacing cv/download video|audio drafts, or implementing image-list.
---

# Media Link (target-supabase-sdk)

## One-line rule

**Media = Link with `value === loaderKey ∈ {video,audio,image,image-list}`.** No new Target category. Register only via Node `registerMediaLink` after dedup + same-host availability.

## Imports

```typescript
import { buildMediaLinkDraft, buildMediaNameFromLocator, MEDIA_VALUES } from "target-supabase-sdk";
import { findMediaLink, checkMediaAvailability, registerMediaLink } from "target-supabase-sdk/node";
```

## `original` contract

| Field | File media | `image-list` |
|-------|------------|--------------|
| `storageProvider` | required | required |
| `locator` | absolute **file** path | absolute **directory** path |
| `contentHash` | SHA-256 hex | `""` |
| `size` | bytes | file count (one level, files only) |
| `mimeType` | from extension | `""` |

Hash algorithm is fixed: `MEDIA_CONTENT_HASH_ALGORITHM = "sha256"` (not stored on the row).

Do **not** put `url`, `producer`, or `mediaKind` in `original` — use `locator` + `tagList`.

## Register

```text
findMediaLink(value, name)
  → exists? return { id, created: false }
checkMediaAvailability(storageProvider, locator, localStorageProvider)
  → storageProvider must equal localStorageProvider (e.g. LOCAL_STORAGE_PROVIDER)
  → locator absolute + reachable
probe → contentHash / size / mimeType
buildMediaLinkDraft → postTarget
```

## image-list

- Absolute directory only; **non-recursive** (immediate children).
- `size` = number of **files** in that level.

## Entry split

All media code lives under `src/shared/media/`. Node-only leaves sit in **`shared/media/node/`**:

| Symbol | Files | Entry |
|--------|-------|-------|
| `buildMediaLinkDraft`, `guessMediaMime`, `mediaLinkDedupFilters`, … | `index.ts` barrel | `.` / browser |
| `registerMediaLink`, `checkMediaAvailability`, `findMediaLink`, `probeMediaOriginal` | `node/media.service.ts`, `node/media.access.ts` | `/node` only |

Never re-export `./node` from `index.ts` (those files import `node:*`). No public package subpath beyond `target-supabase-sdk/node`.

## Related

- [browser-node-exports](../browser-node-exports/SKILL.md)
- [target-draft-build](../target-draft-build/SKILL.md)
- `src/shared/media/README.md`
