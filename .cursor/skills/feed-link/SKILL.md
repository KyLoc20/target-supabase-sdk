---
name: feed-link
description: >-
  Feed convention on Link (feed.image|feed.audio|feed.video|feed.image-list) in
  target-supabase-sdk: buildFeedLinkDraft, system tags .public|.local|.oss,
  registerFeed ingest on Node, feedLinkDedupFilters. Use when creating or ingesting platform feed Links.
---

# Feed Link (target-supabase-sdk)

## One-line rule

**Feed = Link with `value === loaderKey ∈ {feed.image, feed.audio, feed.video, feed.image-list}`.** Draft on default entry; **ingest** (`.public` → `.local`/`.oss`) via Node `registerFeed` only.

## Imports

```typescript
import { buildFeedLinkDraft, feedLinkDedupFilters } from "target-supabase-sdk";
import {
  registerFeed,
  checkFeedLocalAvailability,
  checkFeedOssAvailability,
  FEED_INGEST_SOURCES,
} from "target-supabase-sdk/node";
```

## Lifecycle

1. `buildFeedLinkDraft({ source: ".public", storageProvider omitted, locator: platformUrl, ... })` → `postTarget`
2. `registerFeed({ id, source: ".local"|".oss", storageProvider, locator, localStorageProvider? })`

## System source tags

Leading `.` = system tag (not user tag): `.public`, `.local`, `.oss`.

`original.storageProvider`: `""` for `.public`; non-empty backend id for `.local` / `.oss` (`resolveFeedOriginalStorageProvider`).

## `registerFeed`

| `source` | Locator check |
|----------|----------------|
| `.local` | `storageProvider === localStorageProvider`, absolute path, file or `feed.image-list` directory |
| `.oss` | `http(s)` URL; `HEAD` then ranged `GET` |

Optimistic lock: `details->original->>storageProvider` eq `""` while promoting off `.public`.

Idempotent when same `source` + `storageProvider` + `locator` already stored.

## Entry split

| Symbol | Entry |
|--------|--------|
| `buildFeedLinkDraft`, `buildFeedLinkName`, `feedLinkDedupFilters`, `FEED_VALUES`, `isFeedValue` | `.` |
| `registerFeed`, `FEED_INGEST_SOURCES`, availability checks | `/node` |

Never re-export `./node` from `shared/feed/index.ts`.

## Related

- [media-link](../media-link/SKILL.md)
- `src/shared/feed/README.md`
