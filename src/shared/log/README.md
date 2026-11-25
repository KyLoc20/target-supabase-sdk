# shared/log (deprecated)

Import from **`shared/telemetry`** (or package root / `target-supabase-sdk/node` for persist APIs).

`index.ts` is a thin re-export barrel only. Spool/upload and `log/core` were removed; layout lives under:

```
src/shared/telemetry/
  manager/    # TelemetryManager, createLogger, scope, min-level
  call/       # withCallTelemetry, offer
  transport/  # Supabase fetch + ALS (Node)
  persist/    # local dual-lane disk (Node)
```

See `docs/telemetry.protocol.md`.
