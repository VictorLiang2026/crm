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

`relationship-decay-service.js` 是 Person 级只读读取模块。它只接受已确认的 `context_items`：`relationship_strength` / `relationship_importance` 为人工评估（`inference`），`last_meaningful_interaction_at` 为已确认时间事实（`fact`）；或使用原始 `interactions.importance >= 4`。旧互动适配器只提供频率；客户优先级可作为低置信度重要性代理。服务返回来源引用，不返回原始跟进备注。

## 验证与接入门槛

纯计算和只读服务的隔离测试覆盖不同节奏、稀疏记录、同日去重、过期/未确认资料和不存在 Person。

## 2026-10-01 接入 Person 360

用户确认采用 CRM 与 Person 的经营关系口径，并同意只读 Person 360 卡片。本轮在已有登录保护的 `person_360` 函数增加 `getRelationshipDecay`：仅通过服务端密钥读取 `public.persons`、`context_items`、旧客户优先级及有上限的 Interaction 时间线；`context_items` 被单独限制为 GET。页面显示 `why`、`confidence`、`recommended_action`，明确区分候选提醒、稳定和证据不足；使用客户优先级代用重要性时显示警示。不会写入 Action、Signal 或关系阶段，不自动联系客户。

当前线上关系评估与新 Interaction 资料为空，大多数 Person 预计显示“证据不足”。这不是关系稳定的证明；需要人工记录明确的关系强度和重要互动后，才可能形成可信候选信号。两位 Person 间的有向 `relationships` 不在本轮计算范围。

本轮验证：16 项关系评估与接口隔离测试通过；完整旧功能回归 86 PASS / 0 FAIL / 5 SKIP（线上 AI、写入与移动端等按骨架保留）。静态模块经线上 HTTP 200 与 SHA-256 一致校验。使用测试账号登录后的 `getRelationshipDecay` 真实调用返回 `insufficient_evidence`、有效的 `why` / `recommended_action` / `confidence`，且 `persisted=false`、无接口错误；请求未创建业务记录。只读 SQL 核验测试 Person 存在，`public.context_items` 与 `public.interactions` 均为 0。旧页面全链路未在生产逐页人工点击；浏览器回归使用隔离 fixture。

回滚：本轮没有数据库变更。若页面或接口异常，可从上一发布标签 `release-20261001-045756` 重新部署 `person_360` 及 `/crm/js/modules/person-360.js`，并创建恢复提交；不要回滚数据库数据。
