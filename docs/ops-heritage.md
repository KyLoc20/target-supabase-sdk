# Ops heritage（从 log-service 抽出）

> 调用方 **尚未接线**。本文件说明 SDK 已导出的符号与用法边界。  
> **未抽出：** A（`scan-decoded-lists` / List decode + quarantine）— 按产品决定明确不做。

## 符号一览

| 遗产 | SDK 符号 | 入口 |
|------|----------|------|
| **B** health/obs 时间盒 | `withObservabilityBudget`, `DEFAULT_OBSERVABILITY_BUDGET_MS` | `target-supabase-sdk` |
| **C** 串行 overview probe | `runOverviewProbe`, `runOverviewProbesSerial` + 结果类型 | 同上 |
| **D** 过期前缀截断 | `classifyStalePrefix`, `isCreatedAtStale`, `parseCreatedAtMs` | 同上 |
| **E** 有界并发 | `mapWithConcurrency` | 同上 |
| **F** 重复键安全查找 | `getLatestTarget` | 同上 |

## 用法要点

### B — `withObservabilityBudget`

- `/health`：只读本地 runtime；**不要**包 DB。
- `/observability`：可选 DB/IO 探针用本 helper；超时 → `null`，不抛。

### C — overview probes

- **禁止**单请求内无界 `Promise.all` 多路 `getTargetTotalCount` / 重扫（生产曾 `57014`）。
- HTTP 上优先 **一请求一探针**；`runOverviewProbesSerial` 适合脚本或小清单。

### D — `classifyStalePrefix`

- 输入必须已按 `created_at` **升序**。
- 收集过期 id，遇到第一条未过期即停（与 gc-service 的 bucket 分类不同）。

### E — `mapWithConcurrency`

- 结果顺序与输入一致；可选 `AbortSignal` 停止领取新任务。

### F — `getLatestTarget`

- `maxRows: 1` + `created_at` 排序；默认最新优先。
- 替代可能重复键上的 `getPossibleTarget` / `.maybeSingle()`（PGRST116）。

## 明确不做

| 项 | 说明 |
|----|------|
| A `scan-decoded-lists` | 不进本 SDK |
| 自动改 L3 调用方 | 由各服务自行 import 迁移 |
| log Overview 22 探针定义 | 仍属 log-service 产品；只抽出运行器模式 |
