---
name: chunk-fetch-registry
description: >-
  Opaque chunk restore for target-supabase-sdk Parcel multi-provider:
  registerProviderChunkResolver, installChunkFetchRegistry.
  Use with ParcelManager.reassemble and ChunkResolveProvider modules.
---

# Chunk fetch registry (target-supabase-sdk)

## Import

```typescript
import {
  installChunkFetchRegistry,
  registerProviderChunkResolver,
  type ChunkResolveProvider,
} from "target-supabase-sdk";
```

Location: `src/parcel/chunk-fetch-registry.ts`

Pair with chunk URL helpers (`parseProviderPrefixedUrl`, etc.) from the same package.

## Usage

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

## L3 in each service

Upload adapters, provider probe/rollback, restore serialization mutex — stay in each service.

See storage-service `provider-registry.ts`, `restore-parcel.ts`.
