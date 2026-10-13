# Idea Links (`shared/idea`)

Ideas are a **convention on `Link`**, not a new Target category (`category` stays `link`).

```text
src/shared/idea/
  index.ts              ← browser-safe barrel ONLY (never export ./node)
  idea.interface.ts
  idea.schema.ts
  idea.build.ts
  idea.normalize.ts
  idea.parse.ts
  idea.query.ts
  README.md
  VALIDATION-MATRIX.md
  node/                 ← Node-only (hash + temp download URL helpers)
    index.ts
    idea.hash.ts
    idea.locator.ts
```

## Variants

| Kind | `value` | `name` | `original.content` | `original.url` |
|------|---------|--------|--------------------|----------------|
| Text note | `idea` | Title (caller) | Body text | Source page URL, etc. |
| Clipboard image | `idea` | **`idea.image`** (fixed) | SHA-256 hex of bytes | Temp download URL |

Filter rows with **`value=idea`** only — do not query `details.loaderKey`. When assembling drafts, set **`loaderKey === value === "idea"`**.

There is **no content-hash dedup** for image ideas.

## Package entry split

| Consumer import | What you get | Source |
|-----------------|--------------|--------|
| `from "target-supabase-sdk"` | Draft builders, schemas, parse, list filters | `shared/idea/index.ts` → `browser.ts` |
| `from "target-supabase-sdk/node"` | + `hashIdeaPasteImage`, temp download locators | `shared/idea/node/` → `node.ts` |

**Do not** re-export `./node` from `index.ts` / `browser.ts`.

```typescript
import {
  buildIdeaLinkDraft,
  buildIdeaImageLinkDraft,
  ideaLinkValueFilters,
  IDEA_LINK_VALUE,
  IDEA_IMAGE_LINK_NAME,
  ideaCreateSchema,
  parseIdeaOriginal,
} from "target-supabase-sdk";

import {
  hashIdeaPasteImage,
  buildIdeaTempDownloadLocator,
  buildIdeaPasteRelativePath,
} from "target-supabase-sdk/node";
```

Quick-note (chrome extension) should wrap `buildIdeaLinkDraft` **locally** with extension tags — not via a dedicated SDK export.

---

## Link field rules

| Field | Rule |
|-------|------|
| `value` | Always `idea` |
| `details.loaderKey` | Always `idea` |
| Text `name` | Title; max 500; must not be `idea.image` |
| Image `name` | Fixed `idea.image` via `buildIdeaImageLinkDraft` |
| `description` / `preview` | Default `""` |
| `tagList` | User/system tags; image default `[ ".raw" ]` |

See [VALIDATION-MATRIX.md](./VALIDATION-MATRIX.md) for limits across Zod, builders, and HTTP.

---

## Related

- upload-service: `.cursor/skills/idea-link/SKILL.md`
- `.cursor/skills/link-conventions/SKILL.md`
