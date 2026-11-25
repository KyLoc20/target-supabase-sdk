---
name: telemetry
description: >-
  Local telemetry for target-supabase-sdk: TelemetryManager, LogEntry + CallEntry
  lanes under TARGET_SUPABASE_SDK_TELEMETRY_DIR, withCallTelemetry on core.api,
  Stage-A Supabase fetch (status + Content-Length). Use when enabling persist,
  reviewing transport metrics, or debugging null transportStatus/bytes.
---

# Telemetry (target-supabase-sdk)

Full protocol: [`docs/telemetry.protocol.md`](../../../docs/telemetry.protocol.md) — especially **§4.4** (fetch Stage A risks).

## One-line rule

**Console logs always; disk persist only when `TARGET_SUPABASE_SDK_TELEMETRY_ON` and DIR writable. Never upload telemetry bytes to Supabase.**

## CallEntry transport (Stage A)

| Field | Source |
|-------|--------|
| `transportStatus` | `Response.status` via custom `fetch` on `createClient` |
| `reqBytes` / `respBytes` | Sum of `Content-Length` when present; else `null` |

- **No body clone.** Missing CL → null (expected for many GETs / chunked).
- **Node only:** `initSupabaseFromStandardEnv` passes `createSupabaseTelemetryFetch`; `/node` installs ALS.
- **Browser:** no custom fetch — transport fields stay `null`.
- Multi-HTTP inside one API: bytes sum; status prefers non-2xx.

### Troubleshoot null / wrong metrics

1. Initialized via `initSupabaseFromStandardEnv` (or manual `fetch:`)?
2. App imports `/node`? (ALS installed)
3. Call path goes through `withCallTelemetry`?
4. Response has `Content-Length`?
5. Browser path → expected null
6. See protocol §4.4.5 risk table

## L3 wiring

```typescript
await enableTelemetryPersistFromEnvInChild();
await shutdownTelemetryPersist();
```

Do **not** confuse with **`TARGET_SUPABASE_SDK_SERVICE_ID`** (`SERVICE_ID_ENV`) — that is the claimed Service instance id for Node registration ([node-protocol](../node-protocol/SKILL.md)), not a telemetry switch.

## Node exports

`ensureTelemetryPersistFromEnv`, `enableTelemetryPersistFromEnvInChild`, `shutdownTelemetryPersist`, `flushTelemetry`, `listTelemetryBatches`, `readTelemetryBatch`, `gcTelemetry`, `getTelemetryStats`, `isTelemetryPersistEnabled`.
