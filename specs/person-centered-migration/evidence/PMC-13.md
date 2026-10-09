# PMC-13 证据（evidence/PMC-13）

## 1. 包概述

- 包名：PMC-13｜嘉宾模块完成 Person 与合作资料分离
- 前置：PMC-12 已验收（2026-10-09 用户确认 PASS_WITH_LIMITATIONS）
- 执行日期：2026-10-09
- 状态：**实施完成，待用户验收**

## 2. 影响说明（编码前已向用户说明并经四项裁决确认）

| # | 用户批准裁决 | 落地 |
| --- | --- | --- |
| ① | enrichIdentity **Person 优先读**基础信息（name/phone/wechat/organization），customers 回退 | activity_speakers enrichIdentity（§3） |
| ② | activity_speakers create **去掉自动建 Person+customers 分支**，嘉宾身份不自动代表销售客户 | activity_speakers create（§3） |
| ③ | ai_activity 嘉宾参与者 name **改为 Person 优先读**（经 activity_speakers.person_id→persons.display_name） | ai_activity analyze 参与者 name + recommendTopics 嘉宾池 name（§3） |
| ④ | admin.html 旧入口 `ensurePersonCustomer`（死函数，未被调用）保留不动 | 不改 admin.html（§3） |

嘉宾身份与旧客户联动行为变化：
- **裁决②最终行为**：嘉宾身份不自动代表销售客户，不强制创建客户档案。需要销售角色时走明确的业务操作。
- PMC-08 对嘉宾内部直接创建 customers 分支的接管已完成：旧 `create` 在未传 customer_id 时按姓名查 customers 表无匹配则自动 insert 建档（PMC-01 impact-matrix §7.1 登记）；现 `create` 仅创建 activity_speakers 行，不关联客户。
- person_id 由 service_role 写入（走 person_360 identity 入口），admin.html 嘉宾创建已走 `previewIdentity`/`executeIdentity`（L6011/L6015，提示"不创建客户"）。

## 3. 变更清单（2 个云函数 + 1 个隔离测试，无 migration、无 admin.html 改动）

| 文件 | 变更要点 |
| --- | --- |
| `cloudfunctions/activity_speakers/index.js` | ① **enrichIdentity**（L72-115）：新增 Person 优先读——`person_id` 批量查 `persons`（display_name/phone/wechat/organization/occupation），Person 有值时覆盖原值，原值回退；新增 `linked_person={id,name}` 字段；`linked_customer`/`linked_recruit` 保持原语义不变（customers/v_recruit_candidates 批量查询+回退，失败不阻塞）。② **create**（L136-148）：去掉旧 L134-172 自动建 Person+customers 分支（裁决②）；新行为只创建 activity_speakers 行，未传 customer_id 返回 `customer_id:null`；person_id 由 service_role 写入（走 person_360 入口）。 |
| `cloudfunctions/ai_activity/index.js` | ① **L304-321**：嘉宾参与者 name 从 Person 优先读——select 加 `person_id`，批量取 `persons.display_name` 覆盖原 name（裁决③）；L323 注释更新（PMC-11/13）。② **L467-481**：recommendTopics 嘉宾池 name 从 Person 优先读（同模式批量取 persons.display_name 覆盖）。 |
| `tests/pmc/pmc13-speaker.test.cjs` | 新增：9 个纯离线隔离用例 T1-T9（§6.2） |

全部函数文件 `node --check` 通过。无 migration/rollback。无 admin.html 改动。

## 4. 字段来源分界（验收口径）

| 来源 | 字段 |
| --- | --- |
| **Person（persons，经 activity_speakers.person_id）** | display_name（→name 覆盖）、phone、wechat、organization、occupation（当前基础信息权威） |
| **activity_speakers（嘉宾业务域，不动）** | relationship_stage、expertise、topic_summary、source、last_contact_date/next_contact_date、last_contact_note、cooperation_count、preferred_format、status、notes、customer_id、recruit_candidate_id |
| **ai_activity 参与者（经 activity_speakers.person_id→persons.display_name 覆盖）** | 嘉宾参与者 name（analyze/prepare/recommendTopics 等展示名） |
| **persons 写入** | 本包零 persons 写入；person_id 由 person_360 identity command 写入（本包不涉及） |

## 5. 部署（2 个云函数，均成功）

| 产物 | 结果 |
| --- | --- |
| activity_speakers | 成功（`tools/tcb.ps1 fn code update activity_speakers --env-id crm-d1gkae8ddc930d151`） |
| ai_activity | 成功（`tools/tcb.ps1 fn code update ai_activity --env-id crm-d1gkae8ddc930d151`） |

- 静态文件零改动（admin.html SHA 不变）。
- customers/persons 两表数据零修改；无 migration；无新授权。

## 6. 验证证据

### 6.1 WP04 身份审计（speakers 4/4 mapped）

```
{"kind":"speakers","active":4,"mapped":4,"exceptions":0}
```

- 4 个活跃嘉宾全部有 person_id（PMC-06 migration 20260929133000 已应用）。
- 无 v_activity_speakers 视图（enrichIdentity 代码级联表读，不依赖视图）。

### 6.2 隔离测试（离线 fixture，9/9 全绿）

- 命令：`node --test tests/pmc/pmc13-speaker.test.cjs`（不触网络、不触线上、无模型费用）
- **enrichIdentity（裁决①）**
  - T1：name 从 Person 优先读（person.display_name 覆盖 speaker.name）
  - T2：phone/wechat/organization 从 Person 优先读（覆盖原值）
  - T3：person_id 为空时回退原值（name/phone/wechat/organization 用原值）
  - T4：返回 linked_person 字段（有 person_id 非空，无则 null）；linked_customer/linked_recruit 保持原语义
- **create（裁决②）**
  - T5：不自动建客户（无 customers/persons 表 insert 调用，只写 activity_speakers）
  - T6：未传 customer_id 时返回 customer_id 为 null
  - T7：传入 customer_id 时正常创建且不自动建客户
- **ai_activity 静态检查（裁决③）**
  - T8：ai_activity 嘉宾参与者 name 从 Person 优先读（persons.select + display_name + person_id 覆盖逻辑）
  - T9：ai_activity recommendTopics 嘉宾池 name 从 Person 优先读

### 6.3 WP01 门槛（PASS_WITH_LIMITATIONS）

- `node tests/wp01/run.cjs`：所有关键检查 PASS（catalog/guard-tests/regression/anonymous 全 PASS）
- `node tests/wp01/run.cjs --assert-release`：**WP01 gate PASS**
- blockers=[]（空）；login=MANUAL_LOGIN（非阻断）

### 6.4 regression 107/107

- 全绿（5 SKIP）
- 嘉宾相关：speaker.person-first-create / speaker.person-link / speaker.person.no_auto_identity / speaker.person.create / speaker.person.profile_validation 全 PASS

### 6.5 浏览器回归

- 嘉宾资源池页面（`#/speakers`）正确重定向到登录页（需认证才能访问，符合安全预期）。
- 业务功能回归已由离线 regression 107/107 覆盖。

## 7. 实施中修复的真实缺陷

无（本包无计划外缺陷修复）。

## 8. 共享副本同步

- 本包未修改 `_shared/db.js`、`_shared/ai.js`、`person-service.js`、`context-engine.js`、`skill-registry.js`，无共享副本需同步。
- R11 漂移检测不受影响。

## 9. 未验证项（如实登记，不得视为通过）

1. **浏览器嘉宾资源池页面实测 BLOCKED**：页面重定向到登录页（需认证）。admin.html 嘉宾入口已走 person_360 identity（L6011/L6015→previewIdentity/executeIdentity），提示"不创建客户"；ensurePersonCustomer（L932-1008）为死函数（未被调用），保留不动。iPad 人工回归留待用户验收时执行。
2. **嘉宾软删除/恢复线上演练未做**：受控浏览器禁点删除按钮（工作纪律）；remove action 仅置 `deleted_at`（软删除），不级联删 persons/customers；隔离测试 T5-T7 覆盖 create 不自动建客户+customer_id null 行为。
3. **ai_activity 真实模型链路未实测**：无虚构测试活动；隔离测试 T8/T9 覆盖静态契约（Person 优先读逻辑代码存在）。

## 10. 盘点确认「不改」的对象

| 对象 | 核实结论 |
| --- | --- |
| admin.html 嘉宾入口 | 已走 person_360 identity（previewIdentity/executeIdentity），本包不改 |
| admin.html `ensurePersonCustomer`（L932-1008） | 死函数（未被调用），保留不动（裁决④） |
| activity_speakers.customer_id 列 | 列保留（无 FK 约束，U3 未解）；create 不自动写入 |
| activity_speakers remove action | 仅置 deleted_at（软删除），不改 |
| activity_speakers search action | 仅读 activity_speakers 表（联想搜索），不联 persons，不改 |
| activities / activity_tasks / activity_reports | 嘉宾身份不涉及（activity_tasks PMC-10 已切换；activity_reports PMC-10 已切换） |
| person_360 linkSpeakerPerson / createSpeakerProfile | 已 Person 原生（impact-matrix §6.2），本包不改 |
| customers / persons 数据 | 零修改 |

## 11. 既有缺陷/观察项登记（按工作规则 11：只登记，不顺手修）

- **G-PMC11-1**（沿用登记，未修）：ai_activity analyze top3/no_followup 清洗缺参与者 ID 白名单。本包未触碰 ai_activity analyze 的 top3 逻辑（仅改参与者 name 读取）。
- **G-PMC12-1**（沿用登记，未修）：recruit_candidates 死列 education/mbti 留置。
- 无本包新增缺陷。

## 12. 不变项与红线核对

- 不删除/重命名任何已有对象；无 migration/rollback；无视图变更。
- 嘉宾身份不自动代表销售客户，不强制创建客户档案（裁决②）。
- 新建、选择已有人物、同名确认、修改、软删除、恢复及跨活动使用均不得产生重复 Person：person_id 由 person_360 identity command 写入（需 Selected Person），本包不涉及 Person 创建。
- 删除嘉宾角色不能删除其他角色和历史活动证据：remove 仅置 activity_speakers.deleted_at，不动 persons/customers。
- 某次活动的当时机构/职务属于历史快照时保留其语义：activity_speakers.organization 为嘉宾当前机构（Person 优先读），活动快照（activity_participants 等）保留各自业务语义。
- 不拿真实客户数据测试（仅虚构 fixture）；ID 全程字符串/整数精确匹配。

## 13. 回滚条件

- 代码回滚：`git revert` 本包提交 → 重新部署 activity_speakers / ai_activity 两函数。
- 回滚后行为：
  - enrichIdentity 回到原值直读（不 Person 优先）；linked_person 字段消失。
  - create 回到自动建 Person+customers 分支（旧行为）。
  - ai_activity 嘉宾 name 回到原值直读（不 Person 优先）。
- 无结构/数据回滚（本包无 migration）。

## 14. 验收记录

- **验收日期**：2026-10-09
- **验收人**：用户确认（"好的，执行最终验收确认"）
- **验收结论**：**PASS（通过）**

### 14.1 验收依据

| 证据 | 结果 |
| --- | --- |
| 隔离测试复跑（验收时） | 9/9 全绿（duration 297ms；T1–T9 全 PASS） |
| 受控浏览器生产回归 | S1–S7 共 7 项全 PASS（§14.2；截图存档 `d:\Temp\trae\screenshots\`） |
| WP04 身份审计 | speakers 4/4 mapped, 0 exceptions |
| regression | 107/107 PASS（5 SKIP） |
| WP01 门槛 | PASS（blockers=[]，发布前 assert-release 通过） |
| 部署 | activity_speakers + ai_activity 两函数部署成功（COS 上传） |
| sync-check | 三端全绿（28 函数 170 文件一致；admin.html SHA 不变） |

### 14.2 受控浏览器生产回归（admin.html 真实通道，只读干跑零写库）

| 场景 | 结果 |
| --- | --- |
| S1 登录 | PASS（进入认证后的嘉宾资源池页面） |
| S2 嘉宾资源列表 | PASS：「嘉宾资源」标题正常，4 张嘉宾卡片渲染无「加载失败」（enrichIdentity Person 优先读生产读路径正常） |
| S3 Person 主数据展示 | PASS：卡片姓名正常（赵福祥/沈高山/杨杰等），杨杰卡片微信 fmfrlystar 来自 Person 主数据（Person 优先读生效） |
| S4 工具栏按钮 | PASS：「+ 从 Person 新增嘉宾」「+ 新增嘉宾并核对 Person」「返回活动列表」三按钮齐全 |
| S5 搜索/筛选控件 | PASS：搜索框+全部状态/全部阶段筛选正常 |
| S6 创建流程干跑 | PASS：「选择嘉宾对应的 Person」弹窗打开、搜索（无完整标记的测试名返回「未找到 Person」，符合服务端标记要求的安全行为）、确认按钮正确禁用 |
| S7 取消无写库 | PASS：弹窗取消关闭，零保存零提交（全程无业务写入） |

工作纪律：全程未点击删除按钮、未提交任何表单；原生确认框一律取消。

### 14.3 四项裁决落地确认

| # | 裁决 | 落地状态 |
| --- | --- | --- |
| ① | enrichIdentity Person 优先读基础信息 | ✅ enrichIdentity（L72-115）Person 优先读+原值回退+linked_person 字段；生产浏览器 S2/S3 实测 PASS |
| ② | create 去掉自动建 Person+customers 分支 | ✅ create（L136-148）仅创建 activity_speakers 行（T5-T7 覆盖；UI 已全部走 person_360 identity，legacy 入口仅 list/update/remove） |
| ③ | ai_activity 嘉宾 name Person 优先读 | ✅ ai_activity L304-321 参与者 name + L467-481 recommendTopics 嘉宾池 name（T8/T9 覆盖） |
| ④ | admin.html ensurePersonCustomer（死函数）保留不动 | ✅ 不改 admin.html（sync-check SHA 不变证实） |

### 14.4 验收限制项（非阻塞）

| # | 限制 | 处置 |
| --- | --- | --- |
| L1 | create action 生产写路径未实测（隔离 T5-T7+sync-check SHA 一致覆盖） | 受控浏览器只读纪律，不向生产写测试数据；UI 已不经 create 直连路径（全部走 person_360 identity） |
| L2 | ai_activity 真实模型链路未实测（无虚构测试活动；T8/T9 静态契约覆盖） | 与 PMC-11 同口径沿用登记 |
| L3 | S6 搜索「虚构独立增员甲」未返回候选 | 测试 Person 全名为「【系统测试·勿联系】虚构独立增员甲」，服务端要求完整标记方可匹配（安全行为，非缺陷） |

### 14.5 发布记录

- 代码发布：提交 `9eb03e4`（3 files, +307/-63）；标签 `release-20261009-151917`；部署 activity_speakers + ai_activity 两云函数（无静态文件、无 migration）
- 档案发布：提交 `50f06d6`；标签 `release-20261009-153902`（云端产物未改变）
- 两次发布 sync-check 三端全绿

### 14.6 结论

**PMC-13 验收通过**（PASS）。限制项均为非阻塞登记项，不阻断 PMC-14 开包。
