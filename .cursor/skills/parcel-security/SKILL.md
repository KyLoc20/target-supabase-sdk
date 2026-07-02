---
name: parcel-security
description: >-
  Parcel confidentiality, sharding threat model, and StorageAdapter platform
  choices in target-supabase-sdk. Use when reviewing encrypt/passphrase flows,
  chunk distribution, reassemble security claims, metadata leakage, weak
  passphrases, or adapters (S3, IPFS, GitHub, Telegram, local-dir).
---

# Parcel security & storage

## Product goals (two modes)

| Mode | `encrypt` | Single platform sees |
|------|-----------|----------------------|
| **Anti-review sharding** | `false` (default) | Only its chunk(s) — **plaintext slice**, not full file |
| **Confidentiality** | `true` + passphrase or key | Ciphertext blob(s) only — **cannot read content** without key |

Do not claim plaintext sharding provides secrecy. Do not claim encryption alone prevents a platform from seeing **that** encrypted blobs were stored (metadata, sizes, timing).

## Crypto pipeline (current implementation)

```text
plaintext ──AES-GCM-256 (whole file, single IV)──► ciphertext ──fixed-size split──► chunks
```

- Passphrase → PBKDF2-SHA256 (100k iter) + per-parcel `salt` → AES key (`details.crypto`).
- Raw key mode: `encrypt` without passphrase; caller persists `CreateResult.key` (e.g. `.parcel.key.jwk`).
- `details.checksum` / `details.size` are **plaintext** SHA-256 and byte length (for post-decrypt verify).

## Decryption prerequisites (passphrase mode)

All three are required; missing any one → **no plaintext**:

| # | Asset | Provides |
|---|--------|----------|
| 1 | **Parcel** (`getParcel`) | `chunkList` (URL, `index`, `size`), `crypto.iv`, `crypto.salt`, KDF params |
| 2 | **Passphrase** (or raw **key** in non-PBKDF2 mode) | AES decryption key |
| 3 | **All chunk blobs** | Full ciphertext; GCM auth tag is at end of ciphertext stream |

Raw-key mode: replace #2 with **key file** / `CryptoKey`, not passphrase.

**Platform operator** typically holds only subset of #3, not #1 or #2 → cannot decrypt.

## Partial / out-of-order chunks

- **Partial ciphertext**: incomplete message → AES-GCM decrypt **fails** (no partial plaintext leak).
- **Out-of-order**: `reassemble` sorts by `chunkList[].index`; wrong concat → GCM auth **fails**.
- Shuffling upload order across platforms is **operational** diversity; order is not a secret (stored in Parcel).

## What is NOT secret (metadata leakage)

Even when ciphertext is safe:

- `details.size`, `details.checksum` (plaintext fingerprint)
- Chunk count, per-chunk sizes, `provider`, URLs
- `name`, `value`, `tagList` on Parcel row
- PBKDF2 `salt` (public; enables **offline weak-passphrase guessing**)

Strong passphrases are required; "passphrase not leaked" ≠ safe if passphrase is weak.

## Threat model summary

| Attacker has | Plaintext mode | Encrypted + strong passphrase |
|--------------|----------------|-------------------------------|
| One platform's chunks only | Sees **portion** of file | Sees ciphertext only |
| All chunks, no Parcel | Cannot assemble/decrypt reliably | No `iv`/salt/order → cannot decrypt |
| Parcel + all chunks, no passphrase | Can reassemble **full plaintext** | Cannot decrypt |
| Parcel + chunks + weak passphrase | Full plaintext | May brute-force offline |

## StorageAdapter landscape

Any backend where `upload(data) → { url }` and `fetch(url)` (or provider-specific fetch) works.

| Tier | Examples | Notes |
|------|----------|-------|
| Production S3-compatible | S3, R2, B2, Supabase Storage, MinIO | Best default; stable URLs |
| Decentralized | IPFS (+ Pinata), Arweave | CID/gateway; pin retention |
| Code hosts | GitHub Release, GitLab | Size/rate limits; token fetch |
| Messaging | Telegram, Discord | `file_id` / CDN URLs often **unstable** — may need custom URL scheme + fetch by `Chunk.provider` |
| Ephemeral | transfer.sh, catbox | PoC only |
| Local | `local-dir` (`scripts/`) | Dev; `installLocalChunkFetch` for Node `fetch` |

Ideal multi-platform mix: round-robin `StorageAdapter[]` in `ParcelManager.save` with distinct `provider` strings written to `Chunk.provider`.

Non-HTTP providers (Telegram): store opaque locator in `Chunk.url`, resolve in provider-aware fetch layer — do not assume bare `fetch(url)` forever.

## Implementation guardrails

- Manager: **encrypt whole file then split** — never per-chunk GCM with reused IV.
- Do not log passphrases or export keys to Supabase `details`.
- `postParcel` persists manifest only; chunk blobs live on adapters (`deleteParcel` does not delete blobs).
- CLI: no local `*.parcel.manifest.json`; Parcel row is sole manifest (`getParcel`).

## Review checklist

- [ ] Claims distinguish plaintext sharding vs encryption
- [ ] Decryption docs mention all three prerequisites (or key variant)
- [ ] Weak-passphrase / metadata leakage called out when promising "no leak"
- [ ] New adapter documents `provider`, URL stability, max chunk size vs `chunkSize`
- [ ] `reassemble` uses sorted `index`; verifies per-chunk SHA-256 then plaintext checksum after decrypt
