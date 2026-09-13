---
name: telegram-storage-provider
description: >-
  SDK Node Telegram StorageProviderModule: createTelegramStorageProvider(options),
  opaque file_id chunks, undici ProxyAgent, optional peer undici. Use when wiring
  Telegram parcel upload/restore in L3 services (storage-service, upload-service).
---

# Telegram storage provider (SDK Node)

## Rule

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

## Exports (`target-supabase-sdk/node`)

| Export | Role |
|--------|------|
| `createTelegramStorageProvider` | Factory → `StorageProviderModule` (+ `uploadChunk` / `deleteMessage` / `deleteChunkBlobs`) |
| `PROVIDER_TELEGRAM` | `"telegram"` |
| `encodeTelegramChunkUrl` / `parseTelegramChunkUrl` | `${messageId}\|${fileId}` locators (legacy = bare file_id) |
| `callTelegramApi` / `downloadTelegramChunk` | Low-level Bot API (options-first) |

## Chunk URL + delete

New uploads store `` `${messageId}|${fileId}` `` so `deleteChunkBlobs(parcel)` can call `deleteMessage`.  
Legacy parcels with bare `file_id` **skip** Telegram cleanup (cannot delete by file_id).

`probe()` → Bot API `getMe` (for service readiness).

## Peer

Optional peer **`undici`** — required when `proxyUrl` is set (Clash). Install in the service that uses Telegram.

## Do not

- Put Telegram in the browser entry
- Auto-register on import (side-effect free factory)
- Bake service readiness / Express / tasks into SDK
