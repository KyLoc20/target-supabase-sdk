---
name: log-spool
description: >-
  DEPRECATED stub. Former file spool / LOG_PERSIST / Guard collect-log were removed.
  Use local telemetry (TelemetryManager + TARGET_SUPABASE_SDK_TELEMETRY_*).
  Service instance id env is now TARGET_SUPABASE_SDK_SERVICE_ID (SERVICE_ID_ENV),
  not LOG_SPOOL_SERVICE_ID. See docs/telemetry.protocol.md, telemetry skill,
  and node-protocol skill.
---

# Deprecated: former file-spool upload path

**Removed.** Do not reintroduce `src/shared/log/spool`, `LOG_PERSIST_*`, or Guard `registerCollectLogRunner`.

| Was | Use instead |
|-----|-------------|
| Local log file spool + Guard upload | [telemetry](../telemetry/SKILL.md) · [`docs/telemetry.protocol.md`](../../../docs/telemetry.protocol.md) |
| `LOG_SPOOL_SERVICE_ID` (instance id for spool paths **and** Node registration) | **`TARGET_SUPABASE_SDK_SERVICE_ID`** (`SERVICE_ID_ENV`) — [node-protocol](../node-protocol/SKILL.md) |

Do not set or document `LOG_SPOOL_*` in L3 services.
