---
name: chunk-url
description: >-
  Chunk URL helpers for target-supabase-sdk Parcel multi-provider restore:
  resolveFetchUrl, isHttpUrl, isOpaqueChunkUrl, parseProviderPrefixedUrl.
  Use with chunk fetch registries and StorageProviderModule.
---

# Chunk URL (target-supabase-sdk)

## Import

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

## Usage

```typescript
parseProviderPrefixedUrl("telegram:BQACAg..."); // { provider, locator }
isOpaqueChunkUrl(fileId); // not http/https, not local path
```

## L3 in each service

Provider upload modules, restore mutex — stay in each service. Registry API: skill `chunk-fetch-registry`.

See storage-service `provider-registry.ts`, `restore-parcel.ts`.
