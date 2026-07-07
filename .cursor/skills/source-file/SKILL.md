---
name: source-file
description: >-
  SHA-256 and local source file read helpers for target-supabase-sdk:
  sha256Hex (browser), readAndVerifySourceFile (node).
  Use in Parcel pipelines, tasks, or CLI scripts.
---

# Source file & SHA-256 (target-supabase-sdk)

## Import

```typescript
import { sha256Hex } from "target-supabase-sdk";

import {
  readAndVerifySourceFile,
  nodeBufferToArrayBuffer,
  type SourceFilePayload,
} from "target-supabase-sdk/node";
```

Location: `src/shared/utils/sha256.ts`, `src/node/fs/read-source-file.ts`

## Phase 1 — `sha256Hex` (browser + node)

Used by `ParcelManager` and file read helpers.

## Phase 2 — `readAndVerifySourceFile` (node only)

```typescript
const source = await readAndVerifySourceFile("/path/to/file", {
  maxBytes: 2 * 1024 * 1024 * 1024,
  expectedSha256: optionalDigest,
});
// source.buffer, source.sha256, source.absolutePath, source.size
```

Validates: exists, is file, non-empty (unless `allowEmpty`), size after read, optional max size and expected digest.

## L3

Task orchestration (create-parcel), upload limits from service env, Express uploads — stay in each service.
