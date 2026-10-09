# PMC-16 证据档案：互动、跟进及其他业务引用与历史记录收口

- 环境：生产 CloudBase `crm-d1gkae8ddc930d151`，仅 `public` schema。
- 基线：PMC-15 已验收（PASS），基线标签 `release-20261010-000638`（HEAD `3012684`）。
- 迁移：**无**（本包零数据库结构变更，无需 migration/rollback）。
- 发布标签：`release-20261010-050207`。

## 1. 包概述

PMC-16 完成"其余业务引用和历史兼容"收口：11 张业务表的 ID 语义逐项裁决（业务引用 vs 人物基础信息重复）、互动/跟进双轨时间线的来源标识与去重锁定、OCR 快照恢复闭环修复、软删/恢复/附件/审计链体检。核心结论：**现网归属已正确，无需任何 customer_id→person_id 替换，零结构变更**；唯一功能缺口是 admin.html OCR 恢复分支不检查 `customers.update` 响应（冲突被吞、假成功），已修复。

## 2. 影响说明与裁决（编码前盘点，只读）

盘点工具：`tools/pmc16-q1~q7-*.sql`（结构/RLS/健康/视图/来源分布/附件/软删），结果存 `D:\Temp\pmc16-*.json`。

### 2.1 各表归属判定（11 表，孤儿引用全部 = 0）

| 表 | 行数 | 业务真实主体 | 锚定 | 裁决 |
| --- | --- | --- | --- | --- |
| interactions | 9（全 manual） | 人物互动事实 | person_id NOT NULL FK | 已正确，不动 |
| actions | 4 | 人物行动 | person_id FK + created_by/confirmed_by uid 链 | 已正确，不动 |
| commitments | 2 | 人物承诺 | 同上 | 已正确，不动 |
| followups | 250（软删 1） | 客户跟进业务 | customer_id FK + customer_name 发生时快照 | 客户业务，customer_id 保留；快照名不改写（5 行与当前客户名漂移=历史证据） |
| opportunities | 9（customer 7 / person-only 2） | 机会双轨 | 双 FK（U5 退出另批） | 保留双轨，不合并 |
| products（保险） | 1 | 客户业务 | customer_id FK + customer_name 快照 | 保留 |
| policy_review_reports（检视报告） | 2 | 客户业务 | customer_id FK + customer_name 快照 | 保留；报告快照不改写 |
| gifts | 189 | 客户业务 | customer_id FK + customer_name 快照 | 保留 |
| photos | 8 | 客户业务 | customer_id FK + customer_name 快照 + file_name | 保留 |
| ocr_records | 6（含快照 2） | 客户 OCR | customer_id FK + customer_snapshot 历史证据 | 保留 |
| ai_recommendations | 26 | 客户 AI 建议 | customer_id FK + 派生快照名（PMC-11 起 Person 当前名+双名搜索） | 保留；无 deleted_at（U7 维持登记，生命周期走 nba.status 闭环：open 25 / skipped 1 / completed 0） |

**裁决①（采纳推荐）**：11 表维持现有锚定；不加 person_id 列、不做任何替换、不改写历史快照列；姓名类列全部为"发生时快照"语义（指令②），保留。

### 2.2 双轨与时间线现状（已满足指令目标）

- Person 360 时间线（`person-insights-service.timeline`）= stored interactions + Legacy adapter **只读虚拟投影**（followups/recruit_followups/activity_participants），每行输出 `source: public.表#id` 来源标识；去重 key=`source_type:source_id`，账本行优先于虚拟行；**已删 legacy 行不复活**（activeLegacy 过滤）。同一跟进=一条业务事实两种呈现，无重复统计（无任何计数器混合两源）。
- 发现代码路径不一致：`InteractionService.listForPerson`（Console 互动页签 listInteractions）缺 activeLegacy 防护。现网 interactions 表 0 行 legacy 物化副本（q5：9 行全部 manual），**当前零行为变化**，仅防御未来物化。

**裁决②（采纳推荐）**：不重构，补隔离测试锁定"单条呈现/来源标识/删除不复活"；同时给 listInteractions 补 activeLegacy 过滤与 timeline 对齐（部署 person_360）。

### 2.3 OCR 快照恢复链（唯一功能缺口，已修）

现状链：admin.html 删 OCR → `ocr_records.remove`（硬删，legacy 语义保留）→ 返回 `customer_snapshot`+`personSnapshot`（PMC-07 已加但前端从未消费）→ confirm 后 `customers.update`。PMC-08 服务端已加保护：≥3 桥接字段且当前值漂移 → `OCR_SNAPSHOT_RESTORE_CONFLICT` + conflicts 清单，需 `forceRestore:true` 覆盖。

**缺口**：admin.html 调用后**不检查响应**——冲突被拒仍 toast"已恢复"（假成功）；无 diff、无 forceRestore 路径。违反指令④"不覆盖其他模块更新的人物字段；失败和冲突不销毁恢复依据"。

**裁决③（采纳推荐）**：仅改 admin.html 删除分支——冲突时展示「快照值 vs 当前值」（当前值取自 personSnapshot，键映射 customer_name→display_name、wx_account→wechat），人工确认后 forceRestore 重试或放弃；仅 `ok:true` 报成功。服务端/DB/硬删除语义零改动。

### 2.4 软删/恢复/附件/审计体检（无需变更）

- 客户域 6 子表 deleted_at+delete_batch_id 齐备，remove/restore 走 `crm_delete_batch` RPC（同时间戳级联+批次恢复）。
- 附件：photos 8 行含文件名、0 软删；ocr file_ids 0 孤儿；RLS fn_only。
- 审计链：ai_tasks/ai_runs/ai_results + interactions/actions/commitments 均 service_role only 带 created_by/confirmed_by uid 链；历史 AI 输出/报告/原始附件不改写。
- 登记观察项（不修）：followups 1 行软删无 batch_id（trashList 已按 legacy_delete 兼容，PMC-14 先例）；ai_recommendations 无 deleted_at（U7 登记不变）。

**裁决④（采纳推荐）**：登记项维持，不入本包（U7 结构变更与 followups 清理均需单独授权）。

## 3. 变更清单：代码

| 文件 | 变更 | 部署 |
| --- | --- | --- |
| `cloudfunctions/_shared/interaction-service.js`（母本）+ `cloudfunctions/person_360/interaction-service.js`（同步副本） | listForPerson 增加 activeLegacy 防护：物化账本副本的 legacy 源（followups/recruit_followups/activity_participants）已删除时不再出现；活跃 legacy 物化行仍优先单条呈现（与 PersonInsightsService.timeline 规则一致） | person_360 函数（sync-shared 56 副本校验一致） |
| `admin.html`（OCR 删除分支 L3378-3414） | 恢复闭环：检查 `customers.update` 响应；识别 `OCR_SNAPSHOT_RESTORE_CONFLICT` 并展示冲突字段「当前值（personSnapshot）→ 快照值」diff；人工确认后带 `forceRestore:true` 重试；`ok===false`/error 报失败而非假成功 | admin.html 静态（50 在线资产 SHA 核对一致） |

无 migration、无 RLS/权限/视图变更、无删除或重命名对象。

## 4. 验证证据

- **隔离测试新增**：`tests/pmc/pmc16-business-references.test.cjs` 7/7 PASS——
  - A1 快照整包覆盖与当前值漂移 → 拒绝 + 精确 conflicts（occupation/phone）+ 零写库；
  - A2 快照与当前值一致 → 幂等恢复；
  - A3 人工确认 forceRestore → 覆盖生效；
  - A4 <3 桥接字段 → 普通编辑不拦截；
  - B1 物化副本的 legacy 源已删除 → 不复活；活跃物化行单条呈现（账本优先）；
  - C1 admin.html 静态契约：消费 personSnapshot、检查响应、forceRestore 人工确认、无旧假成功路径；
  - C2 ocr_records.remove 返回双快照、update 不改写 customer_snapshot。
- **既有互动测试**：`tests/interactions/interaction-service.cjs` 11/11 PASS（物化行优先、四源读取、仅 GET 等既有契约未破坏）。
- **全量回归**：175 项 172 过 / 3 失败——3 项全部为 G-PMC14-1 既有（pmc11 fixture 数字 candidate_id 未 String 化，登记未修须单独授权）；基线与本包前一致。
- **WP01 门**：blockers=[]（catalog/wp04 证据刷新后 --assert-release PASS）。
- **部署核对**：person_360 函数更新成功（deploy-function.ps1 含共享哈希校验）；admin.html hosting 部署成功；`tests/wp01/static.cjs` 50 在线资产 SHA 全一致。

## 5. 验收口径对照（指令五项）

| 指令 | 落点 | 证据 |
| --- | --- | --- |
| ①逐项判断归属 | §2.1 表：11 表逐项裁决，孤儿引用全 0 | q1/q3 盘点 |
| ②customer_id 保留/不全局替换/历史快照保留 | 零替换、零加列；5 行 followups 姓名漂移按历史证据保留不改写 | §2.1；q3 name_drift |
| ③双轨来源标识与去重 | 时间线已有 `source: public.表#id` + 去重 + 删除不复活；listInteractions 补齐同款防护；隔离测试 B1 锁定 | §2.2；测试 B1；既有互动测试 11/11 |
| ④OCR 快照恢复安全 | 跨角色修改后不覆盖（服务端冲突门已在，前端闭环补齐）；失败/冲突不销毁依据（冲突清单+personSnapshot 展示、人工确认才覆盖）；老快照（JSON 文本）前端解析容错保持 | §2.3；测试 A1–A4/C1/C2 |
| ⑤软删/恢复/附件/审计 | 体检全绿；不重写历史 AI 输出/报告/附件/已发生互动 | §2.4；q2/q6/q7 |

## 6. 未验证项（如实登记）

- iPad 生产浏览器深度回归（OCR 删除→冲突 diff→覆盖/保持 的人工路径）留用户验收；服务端冲突门与前端逻辑由隔离测试 A/C 组覆盖。
- followups 软删无 batch 1 行、ai_recommendations 无 deleted_at：观察项登记，修复须单独授权。
- G-PMC11-1 / G-PMC12-1 / G-PMC14-1 维持登记未修（均须单独授权）。
