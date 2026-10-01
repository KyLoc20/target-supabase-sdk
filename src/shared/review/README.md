# Review Links (`shared/review`)

Review is a **convention on `Link`**, not a new Target category (`category` stays `link`).

A **Review** records **one user interaction** (for example: open, play, complete, rate, dismiss). **Each interaction creates a new Review row.** **Many review Links may share the same `Link.name`** — the SDK does not define dedup or idempotent create for reviews.

All review code lives under **`src/shared/review/`**. There is no Node-only ingest layer (unlike feed/media register flows) — create drafts on any host and persist with `postTarget` / `createTarget`.

```text
src/shared/review/
  index.ts
  review.interface.ts
  review.build.ts
  review.query.ts
  README.md
```

## Package entry

| Consumer import | What you get |
|-----------------|--------------|
| `from "target-supabase-sdk"` | Draft builder, list filters |

```typescript
import {
  buildReviewLinkDraft,
  reviewLinksForNameFilters,
} from "target-supabase-sdk";
```

---

## Meaning

| Concept | Where it lives |
|---------|----------------|
| Grouping key | `Link.name` — caller-defined (often a subject Target id, not required) |
| Interaction body | `Link.details.original` — caller-defined JSON-serializable payload |
| Review kind | Fixed `Link.value` / `details.loaderKey` = `"review"` |
| Labels | Optional `tagList` (e.g. interaction type, client, experiment) |

Each persisted Review is its **own** Target row (its own `id`). Repeating the same `name` is expected when listing interaction history under one grouping key.

`details.original` is intentionally **untyped** (`unknown`) in the SDK so products can store scores, dwell time, UI state, model output, etc., without a shared schema in this package.

---

## Create input → Link mapping

Built via `buildReviewLinkDraft` → `buildLinkTargetDraft`.

| Create field | Required | Link field |
|--------------|----------|------------|
| `name` | yes | `name` |
| `original` | yes | `details.original` |
| `tagList` | no | `tagList` (default `[]`) |
| `description` | no | `details.description` (default `""`) |

Fixed at build time (not on create input):

| Link field | Value |
|------------|--------|
| `value` | `"review"` |
| `category` | `link` |
| `details.loaderKey` | `"review"` |
| `details.manifestVersion` | `0` |
| `details.preview` | `""` |

---

## Example

```typescript
import { buildReviewLinkDraft } from "target-supabase-sdk";
import { postTarget } from "target-supabase-sdk"; // or your create API

const draft = buildReviewLinkDraft({
  name: subjectTargetId,
  original: {
    action: "complete",
    progress: 1,
    at: new Date().toISOString(),
  },
  tagList: ["client:web"],
});

await postTarget(draft);
```

Every interaction: build a new draft (same `name` is fine) and insert again.

---

## Query

List review Links sharing a `Link.name`:

```typescript
import { reviewLinksForNameFilters, scanTargetList } from "target-supabase-sdk";

const reviews = await scanTargetList({
  filters: reviewLinksForNameFilters(subjectTargetId),
});
```

Filters: `category=link`, `value=review`, `name=<trimmed name>`. Use pagination / `scanTargetList` when history is long.

There is **no** SDK helper for dedup or “find existing review” — callers always create new rows unless they add their own policy.

---

## Recognizing review Links

```typescript
if (link.category === "link" && link.value === "review") {
  const groupingKey = link.name;
  const payload = link.details.original;
}
```

---

## Related

- `src/link/link.build.ts` — `buildLinkTargetDraft`
- `src/shared/media/README.md` — same Link-convention pattern for media
- `src/shared/feed/README.md` — feed Links with richer lifecycle
