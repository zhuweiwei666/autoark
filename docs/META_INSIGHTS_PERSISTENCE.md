# Meta Insights 永久事实与冻结机制

## 数据契约

Meta Graph API 只负责采集和补洞，不是查询数据源。前端、AI 和报表查询必须读取 MongoDB 聚合表；缺失数据必须返回覆盖状态，禁止把 API 失败解释成 `0`。

旧 `/api/facebook/accounts-list`、`campaigns-list`、`countries-list` 会以 307 兼容重定向到 `/api/summary/*`。旧 Dashboard V1、AI Insights 工具和账户 daily-insights 接口也只读 MongoDB，不再要求查询时 Token 有效。AI 投手学习可以分析 14–30 天数据库历史，但每次只实时校准最近三个上海自然日。

Dashboard Summary 返回 `available / dataStatus / coveredDays / expectedDays`。网页只接受 `available=true` 且状态为 `fresh/stale` 的完整日期；遇到 `partial/unavailable` 时保留上一次会话缓存并显示覆盖错误，不把残缺或占位数值当成真实 `0`。

### 永久事实

`MetaInsightsFact` 按以下唯一键保存规范化指标：

```text
provider + date + accountId + campaignId + country
```

仅保存 spend、revenue、impressions、clicks、installs 及来源元数据，不保存完整 Graph API JSON。集合没有 TTL。

已有 `AggCampaign` 历史可用 `backfill:meta-insights-persistence` 初始化为 `country=ALL` 的 legacy 事实。此后账户日完整刷新会用真正的国家明细替换该账户当天旧 snapshot。

### 覆盖账本

`MetaInsightsCoverage` 按以下唯一键记录每个账户日：

```text
provider + date + accountId
```

状态为 `fresh / stale / unavailable`，并记录是否已有快照、最后成功/失败时间、错误码、重试时间、授权类型和冻结时间。集合没有 TTL。

## 调度

- 今天：每 10 分钟。
- 昨天：每小时。
- 前天：每天 23:47 做离开热窗口前的最终校准。
- 更早日期：只有 coverage-gap、Token 恢复或超级管理员定向任务可以强制补拉。
- 同一进程中的日期任务串行执行；同一日期的重复触发会合并。
- Cron、Token 恢复、账户最终结算和管理员刷新共用同一进程级串行队列。
- 失败账户按覆盖账本退避：一般失败 1 小时，明确授权失败 6 小时。
- AI 投手的国家、版位、小时明细永久保存在 `AdPerformanceBreakdown`；长分析窗口只读库，实时请求固定为最近三天。
- 可选的旧 V2 Ad Insights worker 不属于这条事实链；生产必须保持 `FACEBOOK_SYNC_ENABLED=false`，只启用 `FACEBOOK_AGGREGATION_ENABLED=true`。

## 写入安全

1. 发起 Meta 请求前先持久化账户日 attempt；进程中途退出也会留下可重试缺口。
2. Insights 必须完成所有分页，否则整次账户快照失败。
3. 只有成功账户才写事实；新行写完后才清理该账户当天消失的旧行。
4. API、分页或数据库失败不会删除旧事实，也不会写入零值占位。
5. 缓存只能把页面状态标为 `stale`，不能让 Token 补拉任务宣告完成。
6. 超过热窗口的数据只有在覆盖状态为 `fresh` 时才冻结。
7. 账户目录为空或缺少当天既有账户时整轮停止覆盖，并把缺失账户记入账本；不会把目录故障解释成真实 `0`。
8. AI 投手明细也先写入带 snapshotId 的新快照，再删除同窗口消失的旧行；写入失败不会先清空历史。

`/api/agg/coverage` 的 `allTrackedFresh` 只表示账本中已跟踪账户全部 fresh，不声称未知的旧历史天然完整；`legacy` 数量用于识别从旧聚合表迁入、无法追溯原始覆盖面的日期。

## Token 缺口恢复

Token 明确从 active 变成 invalid/expired 时记录 `insightsGapStartedAt`。恢复授权后从该日期开始按以下限制补拉：

- 每个 Token 每轮最多 7 个日期；
- 每轮最多 100 个账户日；
- 使用 `insightsBackfillCursorDate` 持久化进度；
- 已经是 fresh 的账户日直接跳过；
- 只有新的 Meta 响应成功入库才推进游标。

没有历史 gap 字段的旧 Token 使用最近三天作为兼容起点。

## 上线步骤

构建后先 dry-run：

```bash
npm run build
npm run backfill:meta-insights-persistence
```

确认源行数、现有事实数和覆盖数后再显式执行：

```bash
npm run backfill:meta-insights-persistence -- --apply
```

脚本只创建缺失索引并 `$setOnInsert`，不覆盖或删除现有事实。上线后必须回读：

- 两个新集合的唯一索引存在且没有 TTL；
- 历史事实数、覆盖数与源聚合行数相符；
- `/api/agg/coverage` 返回 fresh/stale/unavailable/frozen 数量；
- 日志不存在分页截断，却出现正常的 gap cursor 推进；
- 旧 Token 失败时事实总额不下降且错误账户进入退避。
