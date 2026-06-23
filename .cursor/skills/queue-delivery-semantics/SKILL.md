---
name: queue-delivery-semantics
description: >-
  Message/task delivery semantics (at-most-once, at-least-once, exactly-once) for
  target-supabase-sdk. Use when implementing or reviewing pollTargetList,
  getPollCommandList, postCommand, patchClaimTask, queue dequeue, concurrent workers,
  or deciding RPC / claim / idempotency strategy.
---

# Queue delivery semantics (target-supabase-sdk)

## Three common semantics

| Semantic | Meaning | Typical failure mode |
|--------|---------|----------------------|
| **at-most-once** | Each message processed **at most once** | **Loss** — dequeued but worker crashes before handling |
| **at-least-once** | Each message processed **at least once** | **Duplicate** — handled but ack/delete fails, redelivered |
| **exactly-once** | Processed **exactly once** end-to-end | Hardest; needs DB atomicity + idempotent handlers |

These describe **end-to-end** behavior (queue → business logic), not a single HTTP call.

---

## How to read each semantic

### at-most-once（最多一次）

- Success path: message removed from queue → only one consumer can "win".
- Failure path: removed from queue but **never executed** (crash after DELETE) → **lost forever**.
- Accept when: occasional loss is OK (control commands, best-effort shutdown) or ops can re-post.

### at-least-once（至少一次）

- Consumer may see the **same message twice** (retry, duplicate poll, failed ack).
- Handler must be **idempotent** or dedupe by message id.
- Accept when: must not lose work; duplicates are cheaper than loss.

### exactly-once（恰好一次）

- Neither loss nor duplicate **from the consumer's perspective**.
- Usually: atomic claim/dequeue in DB + idempotent side effects, or transactional outbox.
- Not provided by current `pollTargetList` alone.

---

## Mapping to this SDK (today)

| API / flow | Current semantic (practical) | Notes |
|------------|------------------------------|-------|
| **`pollTargetList`** / **`getPollCommandList`** | **~at-most-once** (best effort) | SELECT → DELETE by `id`; not atomic; see TODO in `core.api.ts` |
| **`patchClaimTask`** / optimistic UPDATE | **Toward at-most-once claim** | Lock on `status = TODO`; lost race throws — another node wins |
| **Task FINISH after claim** | App must handle partial failure | Task claimed (DOING) but crash → needs RESET/TODO recovery |

Single worker per `nodeId` command queue: races are rare. **Multiple processes** polling the same `filterList`: treat as concurrent consumers.

---

## `pollTargetList` concurrency (review checklist)

Current implementation: `SELECT … LIMIT` then loop `deleteTarget({ id })`.

| Risk | What happens |
|------|----------------|
| Overlapping SELECT | Two workers read same rows; DELETE races — one skips |
| SELECT / DELETE gap (TOCTOU) | Row gone between read and delete |
| DELETE 0 rows, no error | Theoretically both could count a row as polled (see TODO) |
| Deleted but not executed | **Message loss** — classic at-most-once |

**Documented in code:** `pollTargetList` JSDoc `TODO(concurrency)` in `src/core.api.ts`.

---

## When to upgrade

Upgrade dequeue when **any** of:

- Multiple workers poll the same queue key (same `nodeId`, same filter)
- Control commands must not be lost silently
- Duplicate delivery causes incorrect side effects (e.g. double shutdown)

---

## Mitigation options (future)

| Approach | Effect | SDK fit |
|----------|--------|---------|
| **RPC + `FOR UPDATE SKIP LOCKED`** | Atomic read-delete in one SQL | Preferred for `pollTargetList` v2 |
| **Claim status** (PENDING → CLAIMED) | UPDATE with optimistic lock, then process + DELETE | Same pattern as `patchClaimTask` |
| **DELETE row count check** | 0 rows → do not add to `polled` | Short-term hardening only |
| **Idempotent handler** | Safe under at-least-once | App layer (`executeCommand`, task plugins) |
| **Re-post / watchdog** | Recover lost work | Scheduler re-sends command if node still alive |

---

## Design guidance for new queue APIs

1. **Name dequeue APIs** so intent is clear (`pollTargetList`, `getPollCommandList` — not plain `getList`).
2. **State semantics in JSDoc** — e.g. "at-most-once; not for multi-consumer without RPC".
3. **Do not assume** `generateResponse.success` rows were all processed — only dequeued.
4. **Prefer claim + idempotent execute** over blind DELETE when loss is unacceptable.
5. **Align with** [optimistic-lock-update](../optimistic-lock-update/SKILL.md) for read-modify-write claims.

---

## Quick reference (Chinese)

| 中文 | English | 一句话 |
|------|---------|--------|
| 最多一次 | at-most-once | 可能丢，一般不重复 |
| 至少一次 | at-least-once | 可能重复，一般不丢 |
| 恰好一次 | exactly-once | 不丢不重，要原子 + 幂等 |
