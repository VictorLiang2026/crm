# Relationship Decay Signal：只读计算底座

2026-10-01 基线：`4d2084f568aae10c3a31802d69a57c079842a3a5` / `release-20261001-011500`；修改前本地、GitHub、CloudBase 源码一致。本轮不改变旧客户、关系、互动或 Today 行为。

## 线上证据与语义边界

- `public.persons` 有 776 条在用记录；`public.relationships`、`interactions`、`context_items` 都是 0 条。旧 `followups` 有 247 条，其中 246 条可精确映射到 Person。
- 只有 21 位 Person 有至少三条旧跟进；最近 24 个月内只有 8 位。旧跟进可以估计节奏，不能自行证明某次是“重要互动”。仅报名活动不算互动。
- `public.relationships` 是两位 Person 之间的有向边；`public.interactions` 仅关联单个 Person。不得把 Person 时间线擅自归因给某条有向边。
- 客户 `sales_priority` 是经营优先级，不是已确认的关系重要性；如用作代理，必须明确标记并降低置信度。

## 计算规则

`relationship-decay-core.js` 根据明确的关系强度、重要性、最近一次重要互动、最近最多 24 次真实互动计算个人历史典型间隔。至少需要三次不同中国日期的互动；忽略未来和两年前的记录，单日多条只算一次。相同的“距今 30 天”可能对每周联系者产生候选信号，对两个月联系者保持稳定。强度、重要性和节奏不规则程度共同调整观察界限；缺失关键证据返回 `insufficient_evidence`，不产生衰减判断。

结果始终包含 `why`、0–1 `confidence`、`recommended_action`；仅为 `signal` 候选，不创建 Action，不写 `public.context_items`，不修改关系阶段。推荐行动要求先核实有无未录入互动，由人决定是否联系。

`relationship-decay-service.js` 是尚未接入旧函数分发的 Person 级只读读取模块。它只接受已确认的 `context_items`：`relationship_strength` / `relationship_importance` 为人工评估（`inference`），`last_meaningful_interaction_at` 为已确认时间事实（`fact`）；或使用原始 `interactions.importance >= 4`。旧互动适配器只提供频率；客户优先级可作为低置信度重要性代理。服务返回来源引用，不返回原始跟进备注。

## 验证与接入门槛

纯计算和只读服务共 9 项隔离单测通过，包括不同节奏、稀疏记录、同日去重、过期/未确认资料和不存在 Person。尚未修改 `person_360` 分发或 Person 360 页面，也未触发线上业务调用。接入前须确定目标是 CRM 与 Person 的经营关系，还是两位 Person 的有向关系；后者还需先设计互动与关系边的明确归属。项目 `AGENTS.md`“修改前”第 3 条要求改动旧接口/页面前明确确认影响与回归范围。
