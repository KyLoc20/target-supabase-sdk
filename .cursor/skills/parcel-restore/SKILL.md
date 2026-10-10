---
name: parcel-restore
description: >-
  Parcel multi-provider restore and upload helpers in target-supabase-sdk:
  resolveFetchUrl, isHttpUrl, isOpaqueChunkUrl, parseProviderPrefixedUrl,
  registerProviderChunkResolver, installChunkFetchRegistry, sha256Hex,
  readAndVerifySourceFile, createTelegramStorageProvider, fetchWithRetry,
  fetchBinaryWithRetry, classifyNetworkError. Use with ParcelManager.reassemble,
  StorageProviderModule, ChunkResolveProvider, Telegram file_id chunks,
  undici ProxyAgent, HTTP clients, adapters, or chunk downloads.
---

# Parcel restore and providers (target-supabase-sdk)

One restore/upload story: **URL shape → global fetch registry → hash/read → Telegram factory → HTTP retry.**

Threat model and encrypt/shard policy: [parcel-security](../parcel-security/SKILL.md).

---

## 1. Chunk URLs

```typescript
import {
  resolveFetchUrl,
  isHttpUrl,
  isLocalFilesystemPath,
  isOpaqueChunkUrl,
  parseProviderPrefixedUrl,
} from "target-supabase-sdk";
```

Location: `src/shared/utils/fetch-url.ts`, `src/parcel/chunk-url.utils.ts`

```typescript
parseProviderPrefixedUrl("telegram:BQACAg..."); // { provider, locator }
isOpaqueChunkUrl(fileId); // not http/https, not local path
```

---

## 2. Chunk fetch registry

```typescript
import {
  installChunkFetchRegistry,
  registerProviderChunkResolver,
  type ChunkResolveProvider,
} from "target-supabase-sdk";
```

Location: `src/parcel/chunk-fetch-registry.ts`

```typescript
registerProviderChunkResolver({
  provider: "telegram",
  resolveChunk: (fileId) => downloadTelegramChunk(fileId),
  matchesOpaqueUrl: (url) => isOpaqueChunkUrl(url),
});

const uninstall = installChunkFetchRegistry();
try {
  await restoreParcel(/* … */);
} finally {
  uninstall();
}
```

`installChunkFetchRegistry` patches `globalThis.fetch` so `ParcelManager.reassemble` can resolve opaque `Chunk.url` values. HTTP URLs still use the original fetch.

Provider upload modules and restore mutex stay in each L3 service (storage-service `provider-registry.ts`, `restore-parcel.ts`).

---

## 3. Source file and SHA-256

```typescript
import { sha256Hex } from "target-supabase-sdk";

import {
  readAndVerifySourceFile,
  nodeBufferToArrayBuffer,
  type SourceFilePayload,
} from "target-supabase-sdk/node";
```

Location: `src/shared/utils/sha256.ts`, `src/node/fs/read-source-file.ts`

`sha256Hex` is used by `ParcelManager` and file read helpers (browser + node).

```typescript
const source = await readAndVerifySourceFile("/path/to/file", {
  maxBytes: 2 * 1024 * 1024 * 1024,
  expectedSha256: optionalDigest,
});
// source.buffer, source.sha256, source.absolutePath, source.size
```

Validates: exists, is file, non-empty (unless `allowEmpty`), size after read, optional max size and expected digest.

---

## 4. Telegram storage provider (Node)

**Inject options — do not read `TELEGRAM_*` inside the SDK.** Services map env → `createTelegramStorageProvider({ botToken, chatId, proxyUrl, … })` and `registry.register(module)`.

```typescript
import {
  createStorageProviderRegistry,
  createTelegramStorageProvider,
  PROVIDER_TELEGRAM,
} from "target-supabase-sdk/node";

const registry = createStorageProviderRegistry();
registry.register(
  createTelegramStorageProvider({
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    chatId: process.env.TELEGRAM_CHAT_ID!,
    proxyUrl: process.env.TELEGRAM_PROXY,
  }),
);
```

| Export | Role |
|--------|------|
| `createTelegramStorageProvider` | Factory → `StorageProviderModule` (+ `uploadChunk` / `deleteMessage` / `deleteChunkBlobs`) |
| `PROVIDER_TELEGRAM` | `"telegram"` |
| `encodeTelegramChunkUrl` / `parseTelegramChunkUrl` | `${messageId}\|${fileId}` locators (legacy = bare file_id) |
| `callTelegramApi` / `downloadTelegramChunk` | Low-level Bot API (options-first) |

New uploads store `` `${messageId}|${fileId}` `` so `deleteChunkBlobs(parcel)` can call `deleteMessage`.
Legacy parcels with bare `file_id` **skip** Telegram cleanup (cannot delete by file_id).

`probe()` → Bot API `getMe` (for service readiness).

Optional peer **`undici`** — required when `proxyUrl` is set (Clash). Install in the service that uses Telegram.

Do not: put Telegram in the browser entry; auto-register on import; bake Express / tasks into the SDK.

---

## 5. Fetch retry

```typescript
import {
  fetchWithRetry,
  fetchBinaryWithRetry,
  isRetryableHttpStatus,
  classifyNetworkError,
  formatNetworkError,
  type FetchInitFactory,
} from "target-supabase-sdk";
```

Location: `src/shared/http/fetch-retry.ts`, `src/shared/utils/network-error.ts`

```typescript
const response = await fetchWithRetry(url, () => ({ method: "POST", body: formData }), {
  label: "My API",
  timeoutMs: 60_000,
  maxAttempts: 3,
  retryBaseMs: 2_000,
  dispatcher: proxyAgent, // optional undici ProxyAgent
  logger,
  hint: " (check proxy)",
});
```

| Option | Default | Purpose |
|--------|---------|---------|
| `maxAttempts` | `1` | Total tries (HTTP + network) |
| `retryBaseMs` | `2000` | Exponential backoff base |
| `maxBackoffMs` | — | Cap delay |
| `dispatcher` | — | undici `ProxyAgent` (typed `unknown`, no undici dep) |
| `isRetryableStatus` | `429`, `5xx` | Override HTTP retry predicate |

**Body + retry:** pass an init **factory** when `maxAttempts > 1` and body may be consumed.

L3 keeps: proxy wiring, API-specific JSON / envelope errors (e.g. Telegram `ok: false`), domain `hint` strings.

---

## Related

- [parcel-security](../parcel-security/SKILL.md)
- [browser-node-exports](../browser-node-exports/SKILL.md)
