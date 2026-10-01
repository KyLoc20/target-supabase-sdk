# Review Links (`shared/review`)

Review is a **convention on `Link`**, not a new Target category (`category` stays `link`).

A **Review** records **one user interaction** with a **subject Target** (for example: open, play, complete, rate, dismiss). **Each interaction creates a new Review row.** The subject is linked by storing the Target id on `Link.name` (`refId` at create time). **Many review Links may share the same `refId`** — the SDK does not define dedup or idempotent create for reviews.

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
| `from "target-supabase-sdk"` | Draft builder, constants, list filters |

```typescript
import {
  buildReviewLinkDraft,
  reviewLinksForTargetFilters,
} from "target-supabase-sdk";
```

---

## Meaning

| Concept | Where it lives |
|---------|----------------|
| Subject Target | `Link.name` — the associated Target id (`refId` when building the draft) |
| Interaction body | `Link.details.original` — caller-defined JSON-serializable payload |
| Review kind | Fixed `Link.value` / `details.loaderKey` = `"review"` |
| Labels | Optional `tagList` (e.g. interaction type, client, experiment) |

Each persisted Review is its **own** Target row (its own `id`). Repeating the same `refId` on `name` is expected when listing interaction history for one subject.

`details.original` is intentionally **untyped** (`unknown`) in the SDK so products can store scores, dwell time, UI state, model output, etc., without a shared schema in this package.

---

## Create input → Link mapping

Built via `buildReviewLinkDraft` → `buildLinkTargetDraft`.

| Create field | Required | Link field |
|--------------|----------|------------|
| `value` | yes | `value` — must be `"review"` |
| `refId` | yes | `name` — subject Target id |
| `original` | yes | `details.original` |
| `tagList` | no | `tagList` (default `[]`) |
| `description` | no | `details.description` (default `""`) |

Fixed at build time (not on create input):

| Link field | Value |
|------------|--------|
| `category` | `link` |
| `details.loaderKey` | `"review"` (same as `value`) |
| `details.manifestVersion` | `0` |
| `details.preview` | `""` |

---

## Example

```typescript
import { buildReviewLinkDraft } from "target-supabase-sdk";
import { postTarget } from "target-supabase-sdk"; // or your create API

const draft = buildReviewLinkDraft({
  value: "review",
  refId: subjectTargetId,
  original: {
    action: "complete",
    progress: 1,
    at: new Date().toISOString(),
  },
  tagList: ["client:web"],
});

await postTarget(draft);
```

Every interaction: build a new draft (same `refId` is fine) and insert again.

---

## Query

List review Links for one subject Target:

```typescript
import { reviewLinksForTargetFilters, scanTargetList } from "target-supabase-sdk";

const reviews = await scanTargetList({
  filters: reviewLinksForTargetFilters(subjectTargetId),
});
```

Filters: `category=link`, `value=review`, `name=refId`. Use pagination / `scanTargetList` when history is long.

There is **no** SDK helper for dedup or “find existing review” — callers always create new rows unless they add their own policy.

---

## Recognizing review Links

```typescript
if (link.category === "link" && link.value === "review") {
  const subjectTargetId = link.name;
  const payload = link.details.original;
}
```

---

## Related

- `src/link/link.build.ts` — `buildLinkTargetDraft`
- `src/shared/media/README.md` — same Link-convention pattern for media
- `src/shared/feed/README.md` — feed Links with richer lifecycle
