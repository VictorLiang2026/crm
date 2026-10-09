# PMC-15 证据档案：角色及关系数据治理

- 环境：生产 CloudBase `crm-d1gkae8ddc930d151`，仅 `public` schema。
- 基线：PMC-14 已验收，基线标签 `release-20261009-215118`（HEAD `85321a4`）。
- 迁移：`cloudbase/migrations/20261009220000_pmc15_role_derivation_relationship_governance.sql`；守卫式回滚：`cloudbase/rollbacks/20261009220000_pmc15_role_derivation_relationship_governance.rollback.sql`；双备份于 `C:\Users\victor\cloudbase\migrations\` 与 `…\rollbacks\`。
- 发布标签：`release-20261009-231926`。

## 1. 包概述

PMC-15 解决三个历史悬空问题：① person_roles 角色行是一次性快照、与业务表有效状态漂移无自动维护；② relationships 无方向类型治理、无来源/确认状态，AI 消费无确认门；③ 旧字段/备注线索可能被误用为事实关系。五项指令全部落地：角色采用「业务派生 + 人工标记」组合模型；关系端点全部以 Person 为锚；方向/类型/有效状态/来源/确认状态及自关系/重复/反向/软删规则以约束固化；旧线索只能产生 pending 候选（当前无写入路径）；角色增删由触发器自动同步，删角色不误伤关系/家庭/其他角色。

## 2. 影响说明（编码前盘点，只读）

盘点工具：`tools/pmc15-q1~q6-*.sql`、`tools/pmc15-steps/s00*`。

- person_roles：UNIQUE(person_id,role)、无 deleted_at；origin∈{legacy_backfill,manual}；实测 799 行中存在漂移：id 703（软删 Person 768 挂 customer）、id 792（Person 773 挂 participant 但无参与证据）；Person 777 同时是有效 customer+recruit 但缺 2 角色行。
- relationships：0 行；无任何应用层 insert/update/delete 调用者（全量 grep 云函数确认）；无来源/确认列。
- households/household_members：confirmed_at/confirmed_by_uid 确认机制已完备；无结构缺口。
- 人物端点核查：assistant、person_360、ai_activity、ai_referral、crm_search_people_v1 等所有人物引用均走 person_id，无姓名/客户身份依赖；发现 context-engine（两副本）与 meeting-prep-context 读取 relationships 无确认过滤——因存量 0 行暂无实际泄漏，但属于必须在本包关闭的语义缺口。
- 影响面说明已随裁决向用户披露；五项推荐裁决依用户预授权（"有'推荐'二字的，直接选择推荐"）直接采纳，登记于 decisions.md 2026-10-09。

## 3. 变更清单：数据库（migration/rollback 成对）

DDL 经 `--role cloudbase_postgres`（对象 owner：cloudbase_postgres_pgdb_pn3idppt；service_role 非 owner 被拒）逐语句应用；查询/DML/RPC 用 service_role。分步证据：`tools/pmc15-steps/s01~s10`。

1. person_roles：origin CHECK 替换为含 `derived`；role CHECK 扩 partner/referrer/alumni/other（加约束兼容，不删列不重命名）。
2. relationships 加 4 列：`source text NOT NULL DEFAULT 'manual' CHECK(source∈{manual,ai_suggested,legacy_note})`、`status text NOT NULL DEFAULT 'pending' CHECK(status∈{pending,confirmed})`、`confirmed_at timestamptz`、`confirmed_by_uid text`；确认一致性 CHECK（pending 必须确认字段全空，confirmed 必须全有）；relationship_type CHECK ∈{family,friend,colleague,business,referral,other}（明确排除 spouse/child/parent/sibling 等家庭词及投保人/被保人）。
3. 新增 `crm_person_roles_derive_v1(p_person_id bigint)`：SECURITY DEFINER、service_role only；按人重算 customer/recruit/speaker/participant（证据均要求业务行 deleted_at IS NULL；customer 支持直链与 legacy_customer_id 桥；participant 认 canonical_person_id；软删 Person 清空派生角色）；人工角色零触碰；ON CONFLICT DO NOTHING 保留既有 manual/legacy_backfill 来源。
4. 新增 `crm_person_role_sync_v1()` 触发器函数 + 5 个 AFTER 触发器：customers（person_id/deleted_at 变更或删除，含 legacy 桥 persons 收集）、recruit_candidates、activity_speakers、activity_participants（canonical_person_id/deleted_at）、persons（legacy_customer_id/deleted_at）。
5. CREATE OR REPLACE `crm_search_people_v1(text,jsonb)`：relationships JOIN 加 status='confirmed'（含 recent_declining_relationships 模板）；签名/授权/security_invoker 语义不变。
6. households/household_members 仅补 COMMENT，行为零变更。
7. 一次性对账 DO（断言先行，74ms 通过后执行）：DELETE id 703/792；为 person 777 补 customer+recruit（origin='derived'）。
8. rollback：守卫式精确回滚（仅在本包新增对象/列存在时 DROP），数据对账逆操作（恢复 703/792、删 777 两行）含存在性守卫；不 DROP 任何表。

## 4. 生产对账结果（s12 postcheck）

- person_roles total=799（对账前同口径：删 2 补 2 净额 0，基线快照 799→799；角色分布 customer 779 / recruit 15 / speaker 4 / participant 1）。
- origin 分布：legacy_backfill 790 / manual 7 / derived 2。
- stale_roles=0、missing_roles=0、roles_on_deleted_persons=0。
- sync_triggers=5；relationships governance 列 4 个齐备；relationships_total=0；test_person_residue=0。

## 5. 变更清单：代码与前端

云函数（已部署 ai_activity、person_360）：

- `cloudfunctions/_shared/context-engine.js` 与 `cloudfunctions/ai_activity/context-engine.js`（共享副本）：FIELDS.relationships 增 status,source；activity_review 关系读取加 `status: 'confirmed'`。两副本 SHA-256 一致。
- `cloudfunctions/person_360/meeting-prep-context.js`：双向 relationships 读取均加 `status: 'eq.confirmed'`，select 增 status,source。

前端 4 静态模块（逐文件精准上传，50 个在线资产 SHA 核对全 PASS）：

- `crm/js/modules/person-profile.js`：ROLES 扩 8 角色；ORIGINS 增 derived；说明文案区分自动派生/人工标记，业务阶段提示以业务页为准。
- `crm/js/modules/console/i18n.js`：新增 participant/role_partner/role_referrer/role_alumni/role_other 中英 key（i18n 字典，t(key)）。
- `crm/js/modules/console/pages/people.js`：ROLE_BADGE 扩 8 角色配色。
- `crm/js/modules/phase14-hubs.js`：角色映射扩 8 角色。
- admin.html 未修改（线上 SHA 一致）。

测试与基线：

- 新增 `tests/pmc/pmc15-roles-relationships.test.cjs`（12 用例）：A1-A7 migration/rollback 静态契约；B1-B3 真实模块行为（context-engine 两副本 confirmed 过滤、meeting-prep 双过滤、i18n 双语 key）；C1-C2 边界（词表/CHECK 约束出现在迁移、触发器证据）。
- `tests/ai-gateway/context-engine.cjs`：fixture relationships 行加 status:'confirmed',source:'manual'。
- `tests/security/expected-public-baseline.json`：登记 2 个新 routine（crm_person_role_sync_v1()、crm_person_roles_derive_v1(p_person_id bigint)，anon/auth=false、service_role=true、security_definer=true）。
- 全部改动 JS `node --check` 通过。

## 6. 验证证据

- 隔离测试：PMC-15 12/12 通过。
- 全量回归：24 个测试文件 168 项，165 PASS；3 fail 均为 G-PMC14-1 既有失败（pmc11 recruit_recommend×2 + recruit_score×1，git stash 基线同 3 fail，非本包引入）。
- 生产事务回归（s11，service_role，单 DO 块全部断言后 `RAISE 'PMC15_TEST_ROLLBACK_OK'` 整体回滚，零残留）：
  - 无证据无角色；recruit/speaker/participant 随业务行插入→派生、软删→清除、恢复→重建；
  - customer 直链路径与 legacy_customer_id 桥路径均正确派生；customers 软删/恢复派生同步；
  - 多角色人物 4 角色并存；软删 Person 派生角色全清但人工 partner 保留；Person 恢复 4 角色回归；
  - relationships 默认 pending/manual；无确认元数据置 confirmed → check_violation；spouse → 词表拒绝；自关系 → 拒绝；重复有向边 → unique_violation；反向边独立允许；confirmed 缺 uid → 拒绝；软删后同边可重建。
- RPC 冒烟（s13）：crm_search_people_v1 三模板均正常；recent_declining_relationships total=0 且 source 标识正确。
- WP01 门：catalog 刷新后 787 检查 0 失败；wp04 audit 0 失败；`node tests/wp01/run.cjs` blockers=[]（PASS_WITH_LIMITATIONS，唯一限制为既有 MANUAL_LOGIN）。
- 静态核对：`node tests/wp01/static.cjs` → 50 reachable assets match cloud（含本包 4 模块）。
- 部署：deploy-function.ps1 ai_activity、person_360 均 Code updated（内含 sync-shared 与 WP01 --assert-release 门）。

## 7. 规则落点（验收口径）

- 角色可解释：派生角色=有效业务事实（触发器实时重算），人工角色=显式人工标记，origin 三值可追溯；业务阶段读业务表，person_roles 不竞争。
- 端点有效：所有人物端点以 person_id 为锚；多角色人物目录/筛选/badge 随服务端实时返回，无本地角色缓存副本。
- 方向与权限：from→to 有向；反向边独立；RLS 不变（anon/authenticated 拒绝、service_role 访问）；新函数 service_role only；AI/搜索/会前只消费 confirmed。
- 删除影响：软删业务行只清对应派生角色；relationships/households/人工角色零影响（s11 实证）。

## 8. 共享副本同步

context-engine.js 共享源与 ai_activity 函数内副本同步修改，SHA-256 一致；npm run check:shared 类核对经 deploy-function.ps1 的 sync-shared 门通过。

## 9. 未验证项（如实登记）

- 生产浏览器 iPad 深度回归（人物详情角色 badge、Console 人物目录多角色筛选）留用户验收；服务端行为已由 s11/s12/s13 与静态 SHA 核对覆盖。
- relationships 当前无任何写入路径：pending 候选生产（旧字段/备注线索扫描）与人工确认 UI 属后续工作包，本包只固化数据契约与消费门。
- G-PMC14-1（pmc11 测试 fixture 漂移致 3 项既有失败）保持登记，修复须单独授权。

## 10. 盘点确认「不改」的对象

- households/household_members 结构与确认流程（仅 COMMENT）；admin.html；其余 26 个云函数；pr/pr_* 全程零接触；customers/recruit_candidates/activity_speakers/activity_participants/persons 表结构零变更（仅挂触发器）；无视图重建（crm_search_people_v1 为 RPC 函数非视图）。

## 11. 既有缺陷/观察项登记

- G-PMC14-1：tests/pmc/pmc11-identity.test.cjs 的 recruit_recommend/recruit_score fixture 与当前生产数据漂移，3 项失败基线即存在；本包不顺手修（规则 11）。

## 12. 不变项与红线核对

仅 public；无表/视图/云函数/路由删除或重命名；migration 与 rollback 成对且双备份；无硬编码模型厂商变更；无 AI 自动写事实关系（pending 默认 + 无写入路径）；Legacy 行为保留；跨模块改动（搜索/AI 上下文/会前）已执行全量回归并记录。

## 13. 回滚条件

需要时按 rollback 文件执行（守卫式）：先应用逆对账（恢复 703/792、删 777 补入行），再 DROP 5 触发器/2 函数/4 列并复原 person_roles origin CHECK；代码回退用本标签前一发布标签重新部署 ai_activity、person_360 与 4 静态模块。生产回滚另行评估数据影响，不静默执行。

## 14. 验收记录

2026-10-09 实施完成并发布，待用户验收。验收对照：角色可解释（派生/人工/origin）、关系端点有效（person_id 锚定）、方向与权限正确（有向边/RLS/confirmed 门）、无客户角色人物/多角色人物/关系删除恢复回归（s11 事务回归全覆盖；s12 漂移=0）。
