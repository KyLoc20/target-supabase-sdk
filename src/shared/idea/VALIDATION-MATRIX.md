# Idea Link validation matrix

Single reference for **where** each constraint is enforced. Limits match upload-service `POST/PATCH /v0/upload/idea` and paste-image behavior.

Legend: **Z** = `ideaOriginalSchema` / `ideaCreateSchema` / `ideaUpdateSchema` (Zod); **B** = `buildIdeaLinkDraft` / `buildIdeaImageLinkDraft`; **H** = upload-service HTTP handler (Zod on request body); **P** = paste-image route (MIME, size, empty buffer).

## Row identity

| Rule | Z | B | H | Notes |
|------|---|---|---|-------|
| `category=link` | — | — | — | Set by `createTarget` / SDK category, not in draft builder |
| `value=idea` | — | ✓ | — | Fixed in builders |
| `loaderKey=idea` | — | ✓ | — | Same as `value` |
| Text `name` non-empty | ✓ create | ✓ | ✓ | `ideaCreateSchema` / builder |
| Text `name` max 500 | ✓ create/update | ✓ | ✓ | |
| Text `name` ≠ `idea.image` | — | ✓ | — | Use `buildIdeaImageLinkDraft` for images |
| Image `name=idea.image` | — | ✓ | — | Fixed in `buildIdeaImageLinkDraft` |
| No title uniqueness / dedup | — | — | — | By design |

## `details.original`

| Field | Z | B | H | Limit / rule |
|-------|---|---|---|----------------|
| `content` | ✓ min 1, max 100_000 | ✓ same | ✓ create/update | Text body or image SHA-256 hex |
| `reviewList` | ✓ max 32 items, each 1–8000 | ✓ | ✓ | Normalized (trim, dedupe) |
| `url` | ✓ max 2000, default `""` | ✓ | ✓ | Image: temp download URL required in builder |
| `heat` | ✓ int ≥ 0, default 0 | ✓ floor 0 | — | PATCH +1 is upload-service only |
| Image `reviewList` | — | ✓ `[]` | — | Builder fixed |
| Image `heat` | — | ✓ `0` | — | Builder fixed |

## `tagList`

| Rule | Z create | B text | B image | Notes |
|------|----------|--------|---------|-------|
| Max 32 tags | ✓ | ✓ | ✓ | |
| Each tag 1–128 chars | ✓ | ✓ | — | Builder checks length on text tags |
| Default image tags | — | — | ✓ `[ ".raw" ]` if omitted | |
| Quick-note `.raw` | — | — | — | Extension local wrapper only |

## Paste-image (bytes → Link)

| Rule | P | B image | Node hash/locator |
|------|---|---------|-------------------|
| MIME whitelist | ✓ | — | — |
| Non-empty buffer | ✓ | — | — |
| Max file size | ✓ `TEMP_FS_MAX_FILE_SIZE` | — | — |
| Optional paste `content` field | — | — | upload-service: caption → `original.content`; empty → hash |
| Content hash (file path) | — | — | `hashIdeaPasteImage` + `buildIdeaPasteRelativePath` |
| Stored `original.content` | ✓ min 1 | ✓ | user text or hash fallback |
| Temp path `idea/paste/{hash}.{ext}` | — | — | `buildIdeaPasteRelativePath` |
| `original.url` temp download | — | ✓ non-empty URL | `buildIdeaTempDownloadLocator` |
| Content-hash dedup before create | — | — | **Not implemented** |

## Query / read

| Rule | SDK | upload-service |
|------|-----|----------------|
| Filter by `value=idea` | `ideaLinkValueFilters` | list/get/delete |
| Image-only list | `ideaImageLinkFilters` | `linkName=idea.image` |
| Parse row `original` | `parseIdeaOriginal` | `toIdeaView` throws if invalid |
| Search `name` / `content` ilike | — | list API only |

## Error style

| Layer | Behavior |
|-------|----------|
| Zod (H / optional client) | Field errors in HTTP 400 |
| `buildIdea*Draft` | `throw new Error("buildIdeaLinkDraft: …")` |
| `parseIdeaOriginal` | Returns `null` (no throw) |
