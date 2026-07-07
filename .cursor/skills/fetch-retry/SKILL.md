---
name: fetch-retry
description: >-
  Fetch with timeout, exponential backoff, and network error classification for
  target-supabase-sdk: fetchWithRetry, fetchBinaryWithRetry, classifyNetworkError.
  Use for HTTP clients, adapters, or chunk downloads.
---

# Fetch retry (target-supabase-sdk)

## Import

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

## Usage

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

## L3 in each service

- Proxy wiring (`ProxyAgent`, env vars)
- API-specific JSON / envelope errors (e.g. Telegram `ok: false`)
- Domain hints in `hint`

See storage-service `src/adapters/telegram/telegram-api.client.ts`.
