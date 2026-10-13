---
name: link-conventions
description: >-
  Feed and Media conventions on Link in target-supabase-sdk. Feed:
  feed.image|feed.audio|feed.video|feed.image-list, buildFeedLinkDraft,
  system tags .public|.local|.oss, registerFeed, createFeed,
  feedLinkDedupFilters. Idea: value=idea, name=idea.image for clipboard images,
  buildIdeaLinkDraft, buildIdeaImageLinkDraft, ideaLinkValueFilters. Media:
  value/loaderKey video|audio|image|image-list, MediaOriginal,
  buildMediaLinkDraft, registerMediaLink, findMediaLink,
  LOCAL_STORAGE_PROVIDER availability. Use when creating or ingesting
  platform feed Links, idea notes or paste-image Links, registering or
  querying media Links, replacing cv/download video|audio drafts, or
  implementing image-list.
---

# Link conventions (target-supabase-sdk)

Feed and Media are **Link rows**, not new Target categories. Drafts on the default entry; ingest / register on `/node`. Review Links are thinner (browser helpers only) — see `src/shared/review/`.

Draft assembly rules: [target-draft-build](../target-draft-build/SKILL.md).

---

## Feed

**Feed = Link with `value === loaderKey ∈ {feed.image, feed.audio, feed.video, feed.image-list}`.** Draft on default entry; **ingest** (`.public` → `.local`/`.oss`) via Node `registerFeed`; **insert already ingested** via `createFeed`.

```typescript
import { buildFeedLinkDraft, feedLinkDedupFilters } from "target-supabase-sdk";
import {
  registerFeed,
  createFeed,
  checkFeedLocalAvailability,
  checkFeedOssAvailability,
  FEED_INGEST_SOURCES,
} from "target-supabase-sdk/node";
```

1. `buildFeedLinkDraft({ source: ".public", storageProvider omitted, locator: platformUrl, ... })` → `postTarget`
2. `registerFeed({ id, source: ".local"|".oss", storageProvider, locator, localStorageProvider?, ossCheck? })`
3. Or `createFeed({ name, value, source: ".oss"|".local", storageProvider, locator, ossCheck? })` when no `.public` row exists

Leading `.` = system tag (not user tag): `.public`, `.local`, `.oss`.

`original.storageProvider`: `""` for `.public`; non-empty backend id for `.local` / `.oss`.

| `registerFeed` source | Locator check |
|-----------------------|----------------|
| `.local` | `storageProvider === localStorageProvider`, absolute path, file or `feed.image-list` directory |
| `.oss` | `http(s)` URL; optional `tryLocalResolve` then `HEAD` / ranged `GET`; inject `ossCheck.fetch` |

Optimistic lock: `details->original->>storageProvider` eq `""` while promoting off `.public`. Idempotent when same `source` + `storageProvider` + `locator` already stored.

| Symbol | Entry |
|--------|--------|
| `buildFeedLinkDraft`, `buildFeedLinkName`, `feedLinkDedupFilters`, `FEED_VALUES`, `isFeedValue` | `.` |
| `registerFeed`, `createFeed`, `FEED_INGEST_SOURCES`, availability checks | `/node` |

Never re-export `./node` from `shared/feed/index.ts`. Details: `src/shared/feed/README.md`.

---

## Media

**Media = Link with `value === loaderKey ∈ {video,audio,image,image-list}`.** Register only via Node `registerMediaLink` after dedup + same-host availability.

```typescript
import { buildMediaLinkDraft, buildMediaNameFromLocator, MEDIA_VALUES } from "target-supabase-sdk";
import { findMediaLink, checkMediaAvailability, registerMediaLink } from "target-supabase-sdk/node";
```

| `original` field | File media | `image-list` |
|------------------|------------|--------------|
| `storageProvider` | required | required |
| `locator` | absolute **file** path | absolute **directory** path |
| `contentHash` | SHA-256 hex | `""` |
| `size` | bytes | file count (one level, files only) |
| `mimeType` | from extension | `""` |

Hash algorithm is fixed: `MEDIA_CONTENT_HASH_ALGORITHM = "sha256"` (not stored on the row).

Do **not** put `url`, `producer`, or `mediaKind` in `original` — use `locator` + `tagList`.

```text
findMediaLink(value, name)
  → local locator exists? return { id, created: false }
  → HTTP locator exists? patch original if storage/locator differ
checkMediaAvailability on local path (locator, or localLocator when locator is http)
probe → contentHash / size / mimeType
buildMediaLinkDraft → postTarget (persisted locator may be HTTP)
```

`image-list`: absolute directory only; **non-recursive**; `size` = number of **files** in that level.

| Symbol | Entry |
|--------|--------|
| `buildMediaLinkDraft`, `guessMediaMime`, `mediaLinkDedupFilters`, … | `.` / browser |
| `registerMediaLink`, `checkMediaAvailability`, `findMediaLink`, `probeMediaOriginal` | `/node` only |

Never re-export `./node` from `shared/media/index.ts`. Details: `src/shared/media/README.md`.

---

## Idea

**Idea = Link with `value === loaderKey === "idea"`.** Text notes use caller `name` (title); clipboard images use fixed **`name === "idea.image"`** (same `value`). Draft on default entry; paste bytes + temp URL on Node.

```typescript
import {
  buildIdeaLinkDraft,
  buildIdeaImageLinkDraft,
  ideaLinkValueFilters,
  IDEA_LINK_VALUE,
  IDEA_IMAGE_LINK_NAME,
} from "target-supabase-sdk";
import {
  hashIdeaPasteImage,
  buildIdeaTempDownloadLocator,
  buildIdeaPasteRelativePath,
} from "target-supabase-sdk/node";
```

1. Text — `buildIdeaLinkDraft({ name, content, url?, tagList?, ... })` → `postTarget` / `createTarget` (no title dedup).
2. Image — store bytes on host, then `buildIdeaImageLinkDraft({ contentHash, url })` (no content-hash dedup).
3. List/filter — `ideaLinkValueFilters()`; query **`value`**, not `loaderKey` (image-only: add `name=idea.image`).

Quick-note tags (e.g. `.raw`) belong in **chrome-extension** wrappers, not the SDK.

| Symbol | Entry |
|--------|--------|
| `buildIdeaLinkDraft`, `buildIdeaImageLinkDraft`, `ideaCreateSchema`, parse, `ideaLinkValueFilters` | `.` |
| `hashIdeaPasteImage`, temp download locators | `/node` |

Never re-export `./node` from `shared/idea/index.ts`. Details: `src/shared/idea/README.md`, `VALIDATION-MATRIX.md`.

---

## Dedup filters (same shape)

Shared helper: `linkDedupFilters({ value, name })` in `src/link/link.query.ts` (exported on the default entry). Domain wrappers (`feedLinkDedupFilters` / `mediaLinkDedupFilters` / `reviewLinksForNameFilters`) stay as typed aliases.

---

## Related

- [target-draft-build](../target-draft-build/SKILL.md)
- [browser-node-exports](../browser-node-exports/SKILL.md)
