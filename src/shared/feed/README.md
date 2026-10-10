# Feed Links (`shared/feed`)

Feed is a **convention on `Link`**, not a new Target category (`category` stays `link`).

```text
src/shared/feed/
  index.ts              ← browser-safe barrel ONLY (never export ./node)
  feed.interface.ts
  feed.build.ts
  feed.name.ts
  feed.query.ts
  README.md
  node/                 ← Node-only (ingest / availability)
    index.ts            ← barrel for src/node.ts only
    feed.access.ts
    feed.service.ts
```

## Package entry split

| Consumer import | What you get | Source |
|-----------------|--------------|--------|
| `from "target-supabase-sdk"` | Draft, name, tag merge, dedup filters | `shared/feed/index.ts` → `browser.ts` |
| `from "target-supabase-sdk/node"` | + `registerFeed`, availability checks | `shared/feed/node/` → `node.ts` |

**Do not** re-export `./node` from `index.ts` / `browser.ts`.

```typescript
// Default / browser — create draft, dedup, recognize feed Links
import {
  buildFeedLinkDraft,
  buildFeedLinkName,
  feedLinkDedupFilters,
  FEED_VALUES,
  isFeedValue,
} from "target-supabase-sdk";

// Node — ingest after .public draft exists
import { registerFeed, createFeed, checkFeedOssAvailability, FEED_INGEST_SOURCES } from "target-supabase-sdk/node";
```

---

## Lifecycle

1. **Create (browser or any host)** — `buildFeedLinkDraft` with `source: ".public"`, public `locator` (often a platform URL), `original.storageProvider: ""`. Persist via `postTarget` / `createTarget`.
2. **Ingest (Node)** — `registerFeed` on an existing row `id`: validate the new locator, then promote `tagList` from `.public` to `.local` or `.oss` and update `original.storageProvider` + `locator`. Preserves `twinList` and other non-source tags.
3. **Create already ingested (Node)** — `createFeed` inserts a new row already tagged `.local` or `.oss` (Filter / OSS-first). Dedup on `category` + `value` + `name`.

---

## Link field rules

| Field | Rule |
|-------|------|
| `value` | `feed.image` \| `feed.audio` \| `feed.video` \| `feed.image-list` |
| `details.loaderKey` | Always equals `value` |
| `name` | `{platformName}.{feedKey}` via `buildFeedLinkName` |
| Dedup | `category=link` + `value` + `name` (`feedLinkDedupFilters`) |
| `tagList` | Exactly one feed **system** source tag (`.public` \| `.local` \| `.oss`) |
| `description` / `preview` | Optional; default `""` |

### Naming

- `sanitizeFeedPlatformName` replaces `.` in `platformName` with spaces before ``${platform}.${feedKey}``.

---

## `details.original`

| Key | `.public` draft | After ingest |
|-----|-----------------|--------------|
| `storageProvider` | `""` | Backend id (required for `.local` / `.oss`) |
| `locator` | Public / platform locator | Validated path (`.local`) or URL (`.oss`) |
| `twinList` | Optional sibling locators | Unchanged by `registerFeed` |

---

## System vs user tags

Leading `.` marks **system** tags (not user tags).

| Tag | Meaning |
|-----|---------|
| `.public` | Public-network link; ingest when stable copy exists |
| `.local` | In Target on this device (`LOCAL_STORAGE_PROVIDER` + absolute file/dir path) |
| `.oss` | In Target on shared storage (HTTP(S) locator must respond) |

`buildFeedTagList` strips `.public` / `.local` / `.oss` from user input and appends the chosen `source` once.

---

## Register flow (`registerFeed`)

**Input**

| Field | Rule |
|-------|------|
| `id` | Existing feed Link row |
| `source` | `.local` or `.oss` only |
| `storageProvider` | Non-empty (validated by `resolveFeedOriginalStorageProvider`) |
| `locator` | New canonical locator after ingest |
| `localStorageProvider` | **Required** when `source` is `.local` (typically `process.env.LOCAL_STORAGE_PROVIDER`). Ignored for `.oss`. |

**Steps**

1. Load target by `id`; must be `category=link` with `isFeedValue(value)` and `loaderKey === value`.
2. **Idempotent** — if `tagList` already has the target `source` and `original` matches `storageProvider` + `locator` → `{ id, updated: false }`.
3. Require `tagList` to include `.public` (not already ingested with different state).
4. **Availability**
   - `.local` — `checkFeedLocalAvailability`: `storageProvider === localStorageProvider`, absolute path, file (or directory for `feed.image-list`) exists and is non-empty where applicable.
   - `.oss` — `checkFeedOssAvailability`: `http(s)` URL; optional `tryLocalResolve` then `HEAD`, then `GET` with `Range: bytes=0-0` if `HEAD` is not supported. Pass `ossCheck.fetch` for proxied outbound.
5. **Update** — `updateTarget` with optimistic lock `details->original->>storageProvider` eq `""` (still `.public` tier). Sets `tagList` via `buildFeedTagList`, updates `original.storageProvider` and `locator`, keeps `twinList`.

**Errors (representative)**

| Condition | Result |
|-----------|--------|
| Not a feed Link | throw |
| Already `.local`/`.oss` with different locator | throw |
| Missing `.public` tag | throw |
| Locator check fails | throw |
| Concurrent ingest (storageProvider already set) | optimistic lock failure |

```typescript
import { registerFeed } from "target-supabase-sdk/node";

const { id, updated } = await registerFeed({
  id: feedLinkId,
  source: ".local",
  storageProvider: process.env.LOCAL_STORAGE_PROVIDER!,
  locator: "D:\\\\data\\\\feeds\\\\bilibili.12345.mp4",
  localStorageProvider: process.env.LOCAL_STORAGE_PROVIDER!,
});
```

---

## Env (Node hosts)

| Variable | Role |
|----------|------|
| `LOCAL_STORAGE_PROVIDER` | This machine’s storage id; pass as both `storageProvider` and `localStorageProvider` for `.local` ingest on this host |

Same variable as media register — see `src/shared/media/README.md`.

---

## Design notes / limitations

| Topic | Current behavior | Possible follow-up |
|-------|------------------|-------------------|
| OSS HTTP | Default global `fetch`; inject `fetch` / `tryLocalResolve` | Signed URLs or provider-specific probes |
| `.local` on another host | Fails availability (by design, like media) | Remote agent ingest |
| `twinList` on ingest | Not re-validated | Optional probe per twin |
| Re-ingest / migrate `.local` → `.oss` | Not supported | New API with lock on prior source tag |

---

## Related

- `.cursor/skills/link-conventions/SKILL.md`
- Media register pattern: `src/shared/media/README.md`
- Optimistic lock: `.cursor/skills/optimistic-lock-update/SKILL.md`
