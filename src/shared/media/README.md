# Media Links (`shared/media`)

Media is a **convention on `Link`**, not a new Target category (`category` stays `link`).

All media code lives under **`src/shared/media/`**. Node-only modules are kept in the **`node/`** subdirectory so the filesystem path matches the package entry split.

## Package entry split (important)

| Consumer import | What you get | Source |
|-----------------|--------------|--------|
| `from "target-supabase-sdk"` | Browser-safe helpers only | `shared/media/index.ts` → `browser.ts` |
| `from "target-supabase-sdk/node"` | + register / availability / probe | `shared/media/node/` → `node.ts` |

There is **no** public subpath like `target-supabase-sdk/shared/media/node` — consumers always use the package `/node` entry.

**Do not** re-export anything from `node/` in `index.ts` / `browser.ts`. Those files import `node:fs` / `node:crypto` / `node:path`. Pulling them into the default entry breaks Chrome/Webpack bundles (`verify-browser-entry` will fail).

```text
src/shared/media/
  index.ts              ← browser-safe barrel ONLY (never export ./node)
  media.interface.ts
  media.build.ts
  media.mime.ts
  media.name.ts
  media.query.ts
  README.md
  node/                 ← Node-only (fs / register)
    index.ts            ← barrel for src/node.ts only
    media.access.ts
    media.service.ts
```

### Correct consumer imports

```typescript
// Default / browser — draft, mime, name, filters
import {
  buildMediaLinkDraft,
  buildMediaNameFromLocator,
  MEDIA_VALUES,
  mediaLinkDedupFilters,
} from "target-supabase-sdk";

// Node workers / CLI — dedup + availability + register
import {
  findMediaLink,
  checkMediaAvailability,
  registerMediaLink,
} from "target-supabase-sdk/node";
```

### Incorrect

```typescript
// BAD: Node-only APIs are not on the default entry
import { registerMediaLink } from "target-supabase-sdk";
```

Internal SDK code:

- Browser-safe leaves: `from "../media.build"` (etc.)
- Node leaves: `from "./media.access"` inside `node/`, or `from "../shared/media/node"` from `src/node.ts`
- Never pull `./node` through the parent `index.ts`

---

## Link field rules

| Field | Rule |
|-------|------|
| `value` | `video` \| `audio` \| `image` \| `image-list` |
| `details.loaderKey` | Always equals `value` |
| `name` | Caller-provided unique key (or `buildMediaNameFromLocator`) |
| `tagList` / `description` | Caller-defined (e.g. producer / scene tags) |
| `details.manifestVersion` | `0` (via `buildLinkTargetDraft`) |
| `details.preview` | `""` |

## `details.original`

| Key | Single file (`video`/`audio`/`image`) | `image-list` |
|-----|----------------------------------------|--------------|
| `storageProvider` | Host / backend id (e.g. `windows-storage:HOSTNAME`) | same |
| `locator` | Absolute file path | Absolute **directory** path |
| `contentHash` | SHA-256 hex (`MEDIA_CONTENT_HASH_ALGORITHM`) | `""` |
| `size` | Byte length | File count (immediate children only, non-recursive) |
| `mimeType` | e.g. `video/mp4` | `""` |

`image-list` rules:

1. `locator` must be an **absolute** directory path.
2. Only **one level** under that directory is considered (no recursion).
3. `size` counts **files** in that level (directories among children are ignored).

## Register flow (`registerMediaLink`)

1. **Dedup** — `category` + `value` + `name` via `findMediaLink`. If present → `{ id, created: false }`.
2. **Availability** — `storageProvider` must equal `localStorageProvider` (typically `LOCAL_STORAGE_PROVIDER` from the service `.env`); `locator` absolute and reachable.
3. **Probe** — stream SHA-256 / `stat` / MIME (or directory file count for `image-list`).
4. **Insert** — `buildMediaLinkDraft` → `postTarget` (race → re-find).

## Env (Node hosts)

| Variable | Role |
|----------|------|
| `LOCAL_STORAGE_PROVIDER` | This machine’s storage id; pass as `localStorageProvider` into availability / register |

Cross-host `storageProvider` cannot be verified on the current process — availability returns `ok: false`.

See `.cursor/skills/media-link/SKILL.md`.
