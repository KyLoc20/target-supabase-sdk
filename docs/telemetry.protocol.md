# Telemetry protocol（target-supabase-sdk）

> **维护规则：** 变更字段、目录、env、flush / GC 语义或公开 API 时，**先改本文**再改代码。  
> 本文是第一期「最小稳定可用」协议；实现阶段以本文为准。  
> 参考：`D:/oss-sdk/docs/telemetry.md`（本地 best-effort、失败不影响主路径）。

---

## 1. 目标与非目标

### 1.1 做什么

| 项 | 说明 |
|----|------|
| 运行时单例升级 | 系统运行时单例由 `LogManager` 升级为 **`TelemetryManager`**（仍可保留兼容别名，见 §9） |
| 日志本地落盘 | 运行时日志 → `{TELEMETRY_DATA_ROOT}/log/`（默认 `data/target-supabase-sdk/telemetry/log`），结构 **`LogEntry`** |
| 调用摘要落盘 | API/过程摘要 → `{TELEMETRY_DATA_ROOT}/call/`，结构 **`CallEntry`** |
| 本地访问接口 | 提供只读查询 / 列举本地已持久化数据的 API |
| 本地 GC 接口 | 提供显式清理本地持久化数据的 API |
| 容量驱动 GC | flush 时若落盘总字节达到上限，**自动删除最旧**文件腾出空间后再写入（或写入后立刻压到上限下） |

### 1.2 不做什么（第一期硬约束）

| 项 | 说明 |
|----|------|
| **不上传 DB** | 本地 telemetry 目录字节**不得**经 LogBatch / List / Guard collect 上传到 Supabase |
| **不影响主路径** | telemetry 埋点、flush、GC、读盘任一环节出错：吞掉 / 降级 / disable；**禁止**改变 API 返回值或向外抛出 |
| 跨进程强一致 | 不做跨进程文件锁、不做 exactly-once |
| 强 fsync | 不要求 `fsync`；crash 允许丢未 flush 缓冲 |

**语义：best-effort。允许丢缓冲、允许丢本批 flush、允许 GC 删文件。**

---

## 2. 概念模型

```text
App / SDK API
    │
    ├─ human log ──► TelemetryManager.log*(…)     ──► LogEntry
    │                      │ console（保留）
    │                      └─ offer → lane=log buffer → flush → {TELEMETRY_DATA_ROOT}/log/*.json
    │
    └─ call wrap ──► TelemetryManager.recordCall(…) ──► CallEntry
                           └─ offer → lane=call buffer → flush → {TELEMETRY_DATA_ROOT}/call/*.json
```

| 概念 | 含义 |
|------|------|
| **Lane** | `log` \| `call` — 两种独立缓冲、独立目录、共享同一套 flush/GC 规则 |
| **TelemetryManager** | 进程内单例：人读日志 + call 记录 + 落盘协调 + 查询/GC 入口 |
| **Batch file** | 一次 flush 写出的 JSON 文件，内含同 lane 多条 entry |

**关联：** `LogEntry` 与 `CallEntry` 可通过可选的 `traceId` 对齐；不要求每条 call 都有对应 log，也不要求强制 `topic`。

---

## 3. 目录与文件

### 3.1 根路径

```text
{TELEMETRY_DATA_ROOT}/
  log/
    {flushedAt}.{pid}.{hash6}.json
  call/
    {flushedAt}.{pid}.{hash6}.json
```

| 符号 | 解析 |
|------|------|
| `TELEMETRY_DATA_ROOT` | 来自 env `TARGET_SUPABASE_SDK_TELEMETRY_DIR`；**调用方未设置时**默认 `data/target-supabase-sdk/telemetry`（相对 `process.cwd()`，除非传入绝对路径） |

开启落盘还须 `TARGET_SUPABASE_SDK_TELEMETRY_ON` 为真，且该目录经校验为**有效**（可创建且可写），见 §6。

### 3.1.1 旧「按 serviceId/role 落盘再上传」还要不要？

**结论：不需要。** 本地双 lane 即可；不再按实例分子目录、不再经 Guard 上传。

| 旧职责（已拆除） | 本协议替代 |
|-------------------|------------|
| 各进程写 `.tmp` | 各进程 `TelemetryManager` 写自己的 buffer → flush 到共享的 `telemetry/log`（文件名带 `pid`，见 §3.2） |
| Guard 扫盘上传 LogBatch | **不做**（硬约束：不上传 DB） |
| 按 `serviceId/role` 分子目录 | 不需要；lane 只有 `log` / `call`，多进程共用同一 lane 目录即可 |
| 按保留天数 GC synced 文件 | 改为 **磁盘字节预算** GC（§7） |

旧 spool/upload 源码与 `LOG_PERSIST_*` 已拆除；本地落盘见 `src/shared/telemetry/persist/**`。  
**Service 实例 id** 另见 `TARGET_SUPABASE_SDK_SERVICE_ID`（`SERVICE_ID_ENV`，Node 归属；**不是** telemetry 开关）。  
若下游 log-service 仍依赖 Supabase `log-batch` List，需另案（读本地文件、或外置采集），**不**在本协议恢复上传。

**多进程：** main / guard / scheduler / worker 可共用同一 `TELEMETRY_DATA_ROOT`；靠文件名中的 `pid` + `hash6` 避免冲突。不在协议内做跨进程锁。

### 3.2 文件名

```text
{flushedAt}.{pid}.{hash6}.json
```

| 部分 | 含义 |
|------|------|
| `flushedAt` | flush **开始**时的 `Date.now()` |
| `pid` | `process.pid`，多进程同目录可区分 |
| `hash6` | 即将写入 body 的 UTF-8 内容的 SHA-256，取前 6 位 hex（同毫秒区分） |

写盘步骤（对齐 oss-sdk）：

1. 写 `{name}.tmp`
2. `rename` → `{name}`
3. 失败：吞错；**本批事件丢弃、不回灌**（防 poison）

### 3.3 Batch 文件 body

```json
{
  "lane": "log",
  "flushedAt": 1730000000123,
  "sdkVersion": "0.x.y",
  "droppedBeforeFlush": 0,
  "entries": [ /* LogEntry[] 或 CallEntry[]，与 lane 一致 */ ]
}
```

| 字段 | 说明 |
|------|------|
| `lane` | `"log"` \| `"call"` |
| `flushedAt` | 与文件名时间戳一致 |
| `sdkVersion` | 与 `package.json` 对齐（实现期可用校验脚本） |
| `droppedBeforeFlush` | 本批写出前因内存 cap 丢弃的条数；成功写出后可将进程内 `dropped` 计数清零 |
| `entries` | 本批条目 |

---

## 4. 数据结构

### 4.1 `LogEntry`（沿用现有，落盘到 `log/`）

与当前 `src/shared/telemetry/manager/telemetry-manager.ts` 一致：

| 字段 | 类型 | 说明 |
|------|------|------|
| `timestamp` | `number` | epoch ms |
| `level` | `LogLevel` | `DEBUG` \| `INFO` \| `SUCCESS` \| `WARN` \| `ERROR` \| `CRITICAL` |
| `message` | `string` | 人读消息 |
| `topic` | `string` | **必填**（现有约束保留） |
| `module` | `string` | scope |
| `traceId` | `string` | scope |
| `traceParentId` | `string \| null` | scope |
| `labels` | `Record<string, string>?` | 可选 |
| `extra` | `string?` | 可选短附加 |
| `data` | `unknown?` | 结构化业务载荷；落盘前实现可做体积截断（见 §8） |

**行为迁移：**

- 仍输出 console（格式选项保留：`formatTimestamp` / `formatEmoji` / `minLevel` 等）。
- 原 `offerToLogPersist` → 改为 offer 到 **本地 log lane**（不再作为「上传 DB」入口）。
- 第一期：**禁止**从该路径再触发 Supabase LogBatch 上传。

### 4.2 `CallEntry`（新增，落盘到 `call/`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | `number` | 调用结束时刻 epoch ms |
| `op` | `string` | 操作名，如 `getTarget`、`createTarget`；也可为 HTTP 路由约定（如 `HTTP GET /v0/...`） |
| `ok` | `boolean` | 成败 |
| `costMs` | `number` | 耗时 ms，一位小数（`performance.now` 差，不足则用 `Date.now`） |
| `errMessage` | `string \| null` | 失败时截断至 **512**；成功为 `null` |
| `resultSummary` | `string \| null` | 短摘要，截断至 **128**；禁止密钥与大 body（§8） |
| `module` | `string \| null` | 可选；默认埋点可为 `"core.api"` |
| `traceId` | `string \| null` | 可选，与日志关联 |
| `extra` | `string \| null` | 可选短标签（如 `category=task`），截断至 **64** |
| `transportStatus` | `number \| null` | 真实 HTTP status（Supabase custom fetch）；未知为 `null` |
| `reqBytes` | `number \| null` | 请求 `Content-Length` 合计（有则累加）；缺 header 则该次不计入，全无则为 `null` |
| `respBytes` | `number \| null` | 响应 `Content-Length` 合计；规则同上 |

**不做单独 `HttpEntry`：** ingress HTTP 也复用 `CallEntry`，用 `op` 命名约定区分；汇总时按 `op`/`module` 过滤。

**Wave 1 计量（Stage A — Supabase custom `fetch`）：** 见 **§4.4**。已弃用 JSON.stringify 估算作为主路径。

**不包含：** `level` / `message` / `topic` / 完整 `data` / `labels` / `traceParentId`。

### 4.3 `ok` 判定（API 包装）

| 情况 | `ok` |
|------|------|
| 函数 **throw** | `false`，`errMessage` = 错误信息截断 |
| 返回 `SupabaseResponse` 且 `success === false` | `false`，摘要可含 `code` / `message` |
| 返回 `SupabaseResponse` 且成功，或非 envelope 正常返回 | `true` |

包装必须 **重新抛出** 原始错误 / **原样返回** 原始结果；record 失败不得影响该行为。

### 4.4 Supabase custom fetch 计量（Stage A）

#### 4.4.1 做什么

**仅 Node** 在 initialize 时传入自定义 `fetch`（`initSupabaseFromStandardEnv` 默认开启）：

```text
initSupabaseFromStandardEnv
  → createSupabaseTelemetryFetch(globalThis.fetch)
  → supabase.initialize({ …, fetch })
  → createClient({ global: { fetch } })   // main + auth
```

Browser / 直接 `supabase.initialize({ url, key })` **不传** `fetch` → supabase-js 默认全局 fetch，**无包装**。

包装层行为：

1. 调用底层 `fetch`
2. 读 **`Response.status`**
3. 读请求 / 响应 header 的 **`Content-Length`**（有则解析为非负整数）
4. 若当前处于 `withCallTelemetry` 的调用上下文（Node **AsyncLocalStorage**），累加到该次 CallEntry
5. **原样返回** `Response` — **不** `clone()`、**不**读 body

一次 `core.api` 调用内多次 HTTP（如 `scanTargetList` 分页）：`reqBytes`/`respBytes` 对「有 CL 的样本」求和；`transportStatus` 优先取 **非 2xx**，否则取最后一次 status。

#### 4.4.2 关联方式

| 环境 | 行为 |
|------|------|
| Node + `initSupabaseFromStandardEnv`（默认） | 安装 telemetry fetch + `/node` 安装 ALS；`withCallTelemetry` 可写入 CallEntry |
| Node 手动 `initialize` | 须自行传 `fetch: createSupabaseTelemetryFetch(...)` 才有计量 |
| Browser | **无**自定义 fetch、**无** ALS；transport 字段保持 `null` |

#### 4.4.3 收益

- 真实 HTTP status（401/404/409/500 等），不再用 envelope 假造 200/400
- bytes 来自 Content-Length，接近 wire（当服务端提供该 header）
- 覆盖经该 client 的 PostgREST 往返；实现集中在 initialize，不必改每个 API 函数体
- Stage A **不读 body**，固定成本接近「读几个 header」，通常可忽略

#### 4.4.4 成本

| 项 | 说明 |
|----|------|
| 每请求 | 包装一层 fetch + 解析 Content-Length；通常 ≪ 1ms |
| 实现 | ALS 上下文 + fetch 包装 + 与 `withCallTelemetry` 协同 |
| 双 client | main / auth 共用同一 telemetry fetch |

#### 4.4.5 风险与排查方向（重要）

后续若出现「CallEntry 指标不对 / supabase 偶发失败 / 流量对不上」，优先按本表排查：

| 风险 | 现象 | 排查 / 缓解 |
|------|------|-------------|
| **关联错误 / 漏挂** | `transportStatus` 总是 `null`，或张冠李戴 | 确认用了 **`initSupabaseFromStandardEnv`**（或手动传了 telemetry `fetch`）且从 **`/node`** 导入（ALS）；`withCallTelemetry` 是否包住发请求路径；Browser 本来无 fetch 包装 |
| **一次 API 多次 HTTP** | bytes 像「偏大」、status 像「最后一跳」 | 属预期：分页 scan 会累加；看 `fetch` 次数需加字段或打日志；非 2xx 优先暴露 |
| **无 Content-Length** | `reqBytes`/`respBytes` 为 `null` 或偏小 | GET 常无 request CL；chunked 响应可能无 CL → Stage A **故意不读 body**，接受 null；勿用 JSON 估算 silently 填假数 |
| **未包在 withCallTelemetry 内的 supabase 调用** | Auth refresh、手写 `supabase.client`、域 API 直打 | fetch 仍执行但 **无 store** → 不记 CallEntry；不要误以为「全站 egress 都进了 call lane」 |
| **Auth 与业务混计** | 若将来在无过滤下汇总 | 当前只有进入 ALS 的 call 才记账；汇总时按 `op`/`module` 过滤 |
| **破坏 supabase-js** | 解析失败、挂起、异常 status 处理 | Stage A **禁止**改 Response / clone body；包装内 try/catch，观测失败不得影响 return |
| **浏览器 bundle** | `node:async_hooks` 泄漏 / 多余 fetch 包装 | ALS 与 telemetry fetch **仅 Node**；browser `initialize` 不传 `fetch`；verify-browser 应保持无 `node:` |
| **与 ingress 混淆** | 把 Supabase egress 当成客户端流量 | 文档与看板标明：fetch 指标 = **egress to Supabase**；ingress 另用 Express + 同名字段覆盖 |
| **数字突变** | 相对旧 JSON 估算突然变 null/变小 | 属方案切换；CL 缺失即 null，不要回退静默估算除非产品明确要求 |

**Stage B（未做）：** 无 CL 时再 `clone`+读 body — 成本与弄坏流的风险显著上升，需单独评审。

---

## 5. TelemetryManager（单例）

### 5.1 职责

| 职责 | 说明 |
|------|------|
| 人读日志 API | 兼容现有 `debug/info/success/warn/error/critical` + `withScope` / `setOptions` / `generateTraceId` |
| Call 记录 | `recordCall(partial)` / 内部供 `withCallTelemetry(op, fn)` 使用 |
| 双 lane 缓冲 | 每 lane：内存数组 + `dropped` + `flushInFlight` + `lastFlushAt` |
| Flush | 条数 / 时间触发；写盘前后做容量 GC（§7） |
| 查询 | 列举/读取本地 batch（§5.3） |
| GC | 显式 GC + flush 时自动 GC（§7） |
| 故障隔离 | 所有落盘与 GC 包在 try/catch；失败可 `console.warn` 一次并可选 disable 写盘 |

### 5.2 建议公开符号（实现期命名可微调，语义不变）

| 符号 | 角色 |
|------|------|
| `TelemetryManager.getInstance` / `telemetryManager` | 单例 |
| `createLogger` 等 | 可继续基于 Manager 的 log API（迁移期） |
| `recordCall` / `withCallTelemetry` | 写 `CallEntry` |
| `flushTelemetry(options?: { lane?: TelemetryLane })` | 手动 flush |
| `isTelemetryPersistEnabled()` | 本地落盘是否启用（校验通过后） |
| `listTelemetryBatches` | 见下 |
| `readTelemetryBatch` | 见下 |
| `gcTelemetry` | 见下 |
| `getTelemetryStats` | 缓冲条数、dropped、各 lane 磁盘估算字节等（best-effort） |

### 5.3 访问本地持久化数据

```ts
type TelemetryLane = "log" | "call";

interface ListTelemetryBatchesInput {
  lane: TelemetryLane;
  /** 最多返回文件数；默认实现自定，建议 100 */
  limit?: number;
  /** 仅返回 flushedAt >= since（文件名解析） */
  sinceMs?: number;
  /** 仅返回 flushedAt <= until */
  untilMs?: number;
}

interface TelemetryBatchMeta {
  lane: TelemetryLane;
  path: string;
  flushedAt: number;
  /** 文件字节数（stat） */
  bytes: number;
}

interface ReadTelemetryBatchInput {
  lane: TelemetryLane;
  /** 绝对或相对 lane 目录的文件名 / 路径 */
  pathOrName: string;
}
```

| API | 行为 |
|-----|------|
| `listTelemetryBatches(input)` | 扫描对应 lane 目录，按 `flushedAt` **新→旧** 排序，返回 `TelemetryBatchMeta[]`；读失败返回 `[]`，不抛 |
| `readTelemetryBatch(input)` | 读并解析一个 batch；坏文件返回 `null`，不抛 |
| （可选）`scanTelemetryEntries` | 按时间窗展开 `entries` 的便利方法；第一期可不实现，用 list+read 组合 |

**注意：** 查询接口只读本地文件；不做远程拉取。

### 5.4 显式 GC

```ts
interface GcTelemetryInput {
  lane?: TelemetryLane; // 缺省：两 lane 都清理
  /** 策略：见 §7；缺省 max-bytes */
  mode?: "max-bytes" | "max-age" | "all";
  /** mode=max-age：删除 flushedAt 早于 now - olderThanMs 的文件 */
  olderThanMs?: number;
  /** mode=max-bytes：目标上限；缺省用 env 容量 */
  maxBytes?: number;
}

interface GcTelemetryResult {
  deletedFiles: number;
  freedBytes: number;
  lane: TelemetryLane | "all";
}
```

| `mode` | 行为 |
|--------|------|
| `max-bytes` | 将该 lane（或两 lane）压到 `maxBytes` 以下：按文件名 `flushedAt` **最旧优先删** |
| `max-age` | 删除过旧文件（需 `olderThanMs`） |
| `all` | 删除该 lane 下全部 batch（危险；仅运维/测试） |

GC 失败：返回已删统计或零；**不抛给业务**。

---

## 6. 环境变量

### 6.0 约定

| 原则 | 说明 |
|------|------|
| 谁提供 | **调用方**通过 `process.env`（或等价）提供；SDK **不**在库内写死业务路径以外的强制配置 |
| 未提供 | 使用本节 **默认值**（不是报错、不是半开） |
| 包前缀 | **`TARGET_SUPABASE_SDK_TELEMETRY_`**（全名，避免与 `OSS_SDK_TELEMETRY_*` / 短前缀歧义） |
| 开启条件 | **仅当** `ON` 为真 **且** `DIR` 解析后经校验为**有效目录** → `persistEnabled === true` |
| 与 `RUNTIME_DATA_DIR` | **解耦**；telemetry 根只看 `TARGET_SUPABASE_SDK_TELEMETRY_DIR`（及其默认值） |

### 6.1 正式 env

| Env | 含义 | 未设置时的默认 |
|-----|------|----------------|
| `TARGET_SUPABASE_SDK_TELEMETRY_ON` | 开关：`true` / `1`（大小写不敏感）视为真；其余为假 | **`false`** |
| `TARGET_SUPABASE_SDK_TELEMETRY_DIR` | `TELEMETRY_DATA_ROOT`（绝对或相对 cwd） | **`data/target-supabase-sdk/telemetry`** |
| `TARGET_SUPABASE_SDK_TELEMETRY_FLUSH_SIZE` | 单 lane 缓冲条数触发 flush | **100** |
| `TARGET_SUPABASE_SDK_TELEMETRY_FLUSH_MS` | 时间触发 flush（ms） | **60000** |
| `TARGET_SUPABASE_SDK_TELEMETRY_MAX_BUFFER` | 单 lane 内存最大条数 | **500** |
| `TARGET_SUPABASE_SDK_TELEMETRY_MAX_DISK_BYTES` | 单 lane 磁盘字节上限 | **64 MiB** |
| `TARGET_SUPABASE_SDK_TELEMETRY_GC_RATIO` | 超限 GC 目标比例 | **0.8** |
| `LOG_MIN_LEVEL` | 日志级别（console；开启落盘时亦过滤 log lane） | 现有行为（与 telemetry 开关无关） |

> 路径拼写以包名 **`target-supabase-sdk`** 为准（`data/target-supabase-sdk/telemetry`）。

### 6.2 开启判定（`persistEnabled`）

```text
on  = parseBool(TARGET_SUPABASE_SDK_TELEMETRY_ON)   // 默认 false
dir = TARGET_SUPABASE_SDK_TELEMETRY_DIR or default    // 默认 data/target-supabase-sdk/telemetry

persistEnabled =
  on === true
  AND dir.trim() !== ""
  AND ensureDirWritable(dir) === true   // mkdir log/ + call/ + probe；失败不抛
```

| `ON` | `DIR` 有效 | 结果 |
|------|------------|------|
| false（默认） | （不检查或检查失败均无关） | **关闭** — 见 §6.4 |
| true | 是 | **开启**落盘 + 缓冲 + 定时 flush + GC |
| true | 否（空、不可写、probe 失败） | **关闭**落盘；可 `console.warn` 一次；**不抛** |

`ensureDirWritable` 仅在 `on === true` 时执行（避免默认关闭时无故创建目录）。

### 6.3 废弃 / 勿混用

| 旧 / 废名 | 态度 |
|-----------|------|
| `LOG_PERSIST_*`（旧落盘/上传开关） | 废弃；**不**映射到本开关 |
| `TSSDK_TELEMETRY_*` / `TARGET_SDK_TELEMETRY_*` | 中间稿，**作废** |
| 仅设 `RUNTIME_DATA_DIR` | **不会**打开本协议 telemetry |
| `LOG_SPOOL_SERVICE_ID` | **已更名** → `TARGET_SUPABASE_SDK_SERVICE_ID`（Node 实例 id，见 node-protocol；**不**控制 telemetry） |

### 6.4 调用方未开启 telemetry 时会怎样？

「未开启」= `persistEnabled === false`，包括：未设 env（走默认 `ON=false`）、显式 `ON=false`、`ON=true` 但目录无效。

| 能力 | 行为 |
|------|------|
| **业务 API**（`getTarget` 等） | **完全不变**：返回值、抛错、耗时语义与无 telemetry 代码时一致 |
| **`withCallTelemetry` 包装** | 仍执行原函数；`recordCall` **立即 return**（不入队、不开定时器、不碰盘） |
| **`recordCall` / flush / 定时器** | no-op；不启动 flush timer |
| **人读日志** `debug/info/…` / `createLogger` | **照常 console**（及 `onLog`）；**不**写入 `telemetry/log` |
| **`listTelemetryBatches` / `readTelemetryBatch`** | 返回 `[]` / `null`；**不抛**；不强制 mkdir |
| **`gcTelemetry` / `flushTelemetry`** | 返回零结果 / no-op；**不抛** |
| **`isTelemetryPersistEnabled()`** | `false` |
| **`getTelemetryStats()`** | 标明 disabled；缓冲为 0 |
| **磁盘** | **不创建** `data/target-supabase-sdk/telemetry`（在默认关闭路径下） |
| **CPU / 内存** | 热路径仅一次布尔判断量级；无 ring 增长 |
| **浏览器入口** | 与「未开启」同：console log 可用；落盘 API 不存在或恒 no-op |

**结论：** 调用方什么都不配时，SDK 表现应接近「只有传统 LogManager 打 console」；call 包装零成本旁路；无隐藏落盘、无隐藏上传。

调研对照（设计意图，非运行时实测）：

| 场景 | 期望 |
|------|------|
| Chrome / 扩展只引 browser 包 | 无 `node:fs`；无本地 telemetry 文件 |
| L3 未改 `.env` | `ON` 默认 false → 与上表一致；升级后**不会**再写旧 spool / 上传（行为变化需在 L3 changelog 说明） |
| 仅设 `ON=true`、不设 `DIR` | 使用默认 DIR；probe 成功则开启；失败则保持关闭且不拖垮 API |
| `ON=true` 但 DIR 指向只读盘 | 关闭落盘；API 与 console 日志仍可用 |

---

## 7. Flush 与容量 GC

### 7.1 内存缓冲（每 lane）

```text
{ entries, dropped, flushInFlight, lastFlushAt }
```

| 规则 | 行为 |
|------|------|
| Append | log emit / call record 成功构造 entry 后 append |
| 内存 cap | 超过 `MAX_BUFFER` → 丢最旧，`dropped++` |
| Flush 触发 | `length >= FLUSH_SIZE` **或** 定时器满足 `FLUSH_MS` 且缓冲非空 |
| 并发 | `flushInFlight` 时跳过第二次 flush |
| 定时器 | 首启后不要因 `lastFlushAt=0` 立刻 flush；从「缓冲中最旧一条时间」或上次成功 flush 起算 |

### 7.2 Flush 流程（单 lane）

```text
1. 若未启用或 buffer 空或 flushInFlight → return
2. take 当前 buffer（清空内存侧本批）
3. 估算写出后该 lane 目录总字节；若 >= MAX_DISK_BYTES → 先 autoGcLane(MAX_DISK_BYTES * GC_RATIO)
4. 写 .tmp → rename
5. 再次测量；若仍 >= MAX_DISK_BYTES → 再 autoGc（防止单文件极大等边界）
6. 写盘失败 → 丢本批；不回灌；不抛
```

**自动 GC 删除顺序：** 解析文件名 `flushedAt`，**升序（最旧先删）**；跳过正在写入的 `.tmp`；删到目录估算字节 ≤ 目标为止。

**字节统计：** 对该 lane 目录下 `*.json`（不含 `.tmp`）做 `stat.size` 求和；统计失败则跳过本轮自动 GC（仍尝试写盘），不抛。

### 7.3 与显式 `gcTelemetry` 的关系

- 自动 GC：仅在 **flush 路径** 且 `persistEnabled` 时触发，目标由 `MAX_DISK_BYTES` + `GC_RATIO` 决定。  
- 显式 GC：运维 / 测试 / 关闭前清理；可指定 `max-age` / `all`。未开启时 no-op。  
- 两者删除规则一致（最旧优先），避免两套策略。

---

## 8. 隐私与体积

禁止写入 call / log 落盘内容的：

- service role key、JWT、passphrase、cookie  
- 完整 signed URL query  
- 文件二进制、超大 `details` / request body  

| 项 | 限制 |
|----|------|
| `CallEntry.errMessage` | ≤ 512 chars |
| `CallEntry.resultSummary` | ≤ 128 chars |
| `CallEntry.extra` | ≤ 64 chars |
| `LogEntry.data` 序列化 | 建议单条序列化后 ≤ **4 KiB**；超出截断为占位说明（实现细节可在代码常量中定义） |

`resultSummary` 推荐形态：`rows=12`、`id=<uuid>`、`success=false,code=…`、`count=3`。

---

## 9. 埋点范围与迁移

### 9.1 Call 埋点（第一期）

**Wave 1（必须）：** `core.api.ts` 全部对外原语（约 13 个），经 `withCallTelemetry` 包装：

- `op` = 函数名  
- 覆盖绝大多数域 API 的真实 DB 往返  

**Wave 2（可选）：** 域级 `*.api.ts` 仅在需要对外 `op` 名时再包；**避免**与 core 双重计时（第一期建议只计 core）。

### 9.2 Log / 旧落盘上传迁移

| 现状 | 本协议目标 |
|------|------------|
| `LogManager` 单例 + console | `TelemetryManager` 承担同等 API |
| 旧 offer → 本地 spool 目录 → Guard 上传 | → **仅**本地 `telemetry/log`；**拆除** spool 写与 collect-log 上传 |
| `LOG_PERSIST_*` | 停止作为落盘开关；L3 改为 `TARGET_SUPABASE_SDK_TELEMETRY_ON` + 可选 `…_DIR` |
| 旧 `LOG_SPOOL_SERVICE_ID` | → `TARGET_SUPABASE_SDK_SERVICE_ID`（仅 Node/registry 实例 id；与落盘无关） |
| Supabase `log-batch` / log-service 拉 List | 本协议不提供替代上传；需要汇聚时另案读本地或外置 agent |
| 调用方不配 telemetry env | 见 §6.4：仅 console 日志 + API 旁路；无落盘 |

### 9.3 兼容别名

建议迁移窗口：

- `logManager` → 指向同一单例或薄委托到 `telemetryManager` 的 log 子集  
- 类型 `LogEntry` / `LogLevel` / `createLogger` **保留导出名**，降低 L3 改动面  

### 9.4 源码布局

```text
src/shared/telemetry/
  manager/     # TelemetryManager、createLogger、scope、min-level
  call/        # withCallTelemetry、offer
  transport/   # createSupabaseTelemetryFetch、ALS context（Node 侧 effect 安装）
  persist/     # buffer / flush / gc / query（仅 Node 入口导出）
  env.ts / types.ts / index.ts
src/shared/log/   # 废弃：仅薄 re-export → telemetry
```

---

## 10. 故障隔离（硬规则）

```text
try {
  // buffer / flush / gc / list / read / recordCall 副作用
} catch {
  // swallow；可选计数 + 单次 console.warn
}
```

| 场景 | 要求 |
|------|------|
| `recordCall` 内部异常 | API 结果与抛错行为不变 |
| `withCallTelemetry` | `finally`/分支里 record；**先**保证 return/throw 原结果 |
| flush / GC I/O 失败 | 不向上抛 |
| list/read 坏 JSON | 跳过或 `null` |
| browser 入口 | **不得**因本模块导入 `node:fs`；写盘与目录 API 仅 `target-supabase-sdk/node`（或动态/分入口）。默认 browser：console log + call no-op 或仅内存且不导出 flush 文件 API |

---

## 11. 与 oss-sdk / 旧落盘上传对照

| | oss-sdk telemetry | 本协议 | 旧落盘上传（已拆除） |
|--|-------------------|--------|----------------------|
| 目的 | 存储 API cost | 日志 + API call 双 lane | L3 多进程 → 上传汇聚 |
| 落盘 | 本地单目录 | `telemetry/log` + `telemetry/call` | 按 `serviceId/role` 分子目录 |
| 上传 DB | 否 | **否** | Guard → List `log-batch` |
| 容量 | 内存 ring | 内存 + **磁盘 MAX_DISK_BYTES GC** | 按保留天数 GC |
| Env 前缀 | `OSS_SDK_TELEMETRY_*` | `TARGET_SUPABASE_SDK_TELEMETRY_*` | 旧 `LOG_PERSIST_*`（废弃） |
| 默认根 | 调用方 `…_DIR` | 默认 `data/target-supabase-sdk/telemetry` | （已拆除） |
| 单例 | 模块 buffer | **TelemetryManager** | （已拆除） |
| Service 实例 id | — | **`TARGET_SUPABASE_SDK_SERVICE_ID`**（Node 归属，非本协议开关） | 曾与落盘路径共用旧名 |

---

## 12. 验收标准（第一期）

1. **未设任何 telemetry env**（`ON` 默认 false）：不创建默认 telemetry 目录；API 行为不变；console 日志仍可用；list/gc/flush 安全 no-op（§6.4）。  
2. `ON=true` 且默认或自定义 `DIR` 可写：`…/log` 与 `…/call` 出现 batch，字段符合 `LogEntry` / `CallEntry`。  
3. `ON=true` 但 `DIR` 不可写：`persistEnabled=false`；API 仍成功；不抛。  
4. 磁盘超 `MAX_DISK_BYTES` 后再 flush：最旧文件被删，不抛。  
5. 埋点内部 throw 时，被包装 API 仍按业务语义返回/抛错。  
6. browser 无 `node:fs` 泄漏。  
7. 无路径把 telemetry 目录上传 Supabase；不再写入旧 spool 目录。  
8. 仅设 `LOG_PERSIST_ENABLED` **不会**打开本协议落盘。

---

## 13. 实现顺序（文档约束，非本变更）

1. 本文定稿（本文件）  
2. `TelemetryManager` + 双 lane buffer/flush/GC + 查询 API（Node）；严格按 §6.2 判定 `persistEnabled`  
3. 迁移 log emit → 本地 `log` lane（仅 persist 开启时）；**停写旧 spool、停 Guard collect-log 上传**  
4. `withCallTelemetry` 挂 `core.api`（未开启时早退）  
5. 兼容别名与导出边界（browser / node）；L3 文档改用 `TARGET_SUPABASE_SDK_TELEMETRY_*`  
6. 删除或抽空 `spool/**`；skill 指向本文  
7. 单测：默认关闭无建目录、ON+坏 DIR、flush 容量 GC、故障隔离、browser 无 fs  

---

## 14. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-11-25 | 初稿：LogManager→TelemetryManager；log/call 双 lane 本地落盘；访问/GC API；flush 容量自动 GC；明确不上传 DB、不影响主路径 |
| 2026-11-25 | 裁定 **废弃 log-spool**；中间稿 `TSSDK_TELEMETRY_*` + `RUNTIME_DATA_DIR`；文件名加入 `pid` |
| 2026-11-25 | env 定为调用方提供、缺省用默认：`TARGET_SUPABASE_SDK_TELEMETRY_ON`（默认 false）+ `…_DIR`（默认 `data/target-supabase-sdk/telemetry`）；**ON 且 DIR 有效**才开启；增补 §6.4 未开启行为 |
| 2026-11-25 | **落地 v0.3.5：** `TelemetryManager`、双 lane persist、`withCallTelemetry` 挂 `core.api`；删除 spool/upload/log-batch；upload-service 首迁 |
| 2026-11-25 | `CallEntry` 增加 `transportStatus` / `reqBytes` / `respBytes`（未知为 `null`；不引入 HttpEntry） |
| 2026-11-25 | `withCallTelemetry`：曾用 JSON UTF-8 近似计量（已弃用为主路径） |
| 2026-11-25 | **Stage A：** Supabase `global.fetch` 包装，只读 status + Content-Length；Node ALS 关联；§4.4 含风险排查表 |
| 2026-11-25 | Browser **不**包 fetch；仅 Node `initSupabaseFromStandardEnv`（或手动）传入 telemetry fetch |
| 2026-11-25 | `shared/log` → `shared/telemetry` 按 manager/call/transport/persist 重组；删除 spool/upload/core 残留 |
| 2026-11-25 | Service 实例 id：`LOG_SPOOL_SERVICE_ID` → **`TARGET_SUPABASE_SDK_SERVICE_ID`**（`SERVICE_ID_ENV`）；读侧短暂兼容旧键 |
