# Handoff（接管状态）

更新时间：2026-10-10（**PMC-20 获批清理、最终回归与 Codex 交接完成——Person 中心化迁移 PMC-00～PMC-20 全部收官**。PMC-18 定时监测继续运行中）。任何工具接手前先读本文件与 execution-contract。

## 1. 执行状态

| 项 | 值 |
| --- | --- |
| 当前执行工具 | **Codex 接管**（Trae 已完成 PMC-00～PMC-20 交接）；PMC-18 定时监测已实施，观察中（90 天周期至 2027-01-08，结束条件=周期到期+用户审阅） |
| 最后验收通过包 | **PMC-20（2026-10-10 本包收尾）**：清理后终态复核 + 运行时回归修复 + 全领域最终回归 + 文档终态化。清理主体为 PMC-19 CL-01~CL-09（用户批准全部清理项）。最后验证时间 2026-10-10，发布提交与标签见 §2；线上入口：admin `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`、console `…/crm/console.html`。详见 evidence/PMC-20.md |
| 正在执行包 | 无（PMC-20 收官后停止，等待用户下一项指令） |
| 下一步唯一允许执行的动作 | **等待用户下发新指令。不默认继续旧计划；PMC-18 定时监测继续运行，发现异常按修复包处理（见 §8 下一项允许工作的白名单）** |
| 回滚条件 | **PMC-20**（3 个 DB 函数兼容修复）：`cloudbase/migrations/20261010190000_pmc20_fix_actions_guard.rollback.sql` + `…190100…pmc20_fix_person_roles_derive.rollback.sql` + `…190200…pmc20_fix_search_people.rollback.sql`（原函数体逐字复原）+ `git revert` 本包提交 → 重新部署受影响 12 云函数与 crm/person-360.js。**PMC-19**：CL-05/06/01 rollback（`20261010163000/163100/163200`）；CL-02 rollback（`20261010164000/164100` + 6 函数迁移 rollback）；CL-04/08/09 rollback（`20261010170600/170610/170700/170800`）；CL-03 恢复链：`20261010180000` rollback（ADD COLUMN + 从 customers.person_id 全量回填含软删行，783/783 实测）→ `20261010170900` rollback（复合 UNIQUE + 旧触发器）→ `20261010180100` rollback（旧 crm_person_role_sync_v1 函数体）→ `git revert 0c511db` → 重新部署 5 函数。PMC-18：`cloudbase/rollbacks/20261010115000_pmc18_observation_table.rollback.sql` + 删 pmc18_observer 云函数 + 删 pmc18_daily_0200 定时触发器。PMC-17 migration B：`cloudbase/rollbacks/20261010093000…`；migration A：`…091000…`；代码 `git revert` + 重新部署 customers/assistant/person_360。更早包回滚见 git 历史 evidence |

## 2. 版本基线（2026-10-09 PMC-13 发布时更新）

| 端 | 值 |
| --- | --- |
| PMC-11 前基线 | `master` @ `cbad9aa`（PMC-10 验收提交，标签 `release-20261008-2311`），工作树干净 |
| PMC-11 发布 | 标签 `release-20261009-0105`（时间戳）+ `v2.1.2`（2026-10-09 首提交 semver，patch：AI 适配向后兼容）；G-PMC11-2 修复标签 `release-20261009-0808`；**最终验收登记标签 `release-20261009-0823`** |
| PMC-12 发布 | 提交 `522fbca`（20 files, +797/-52）；标签 `release-20261009-141318`；部署 recruit_candidates/recruit_score/recruit_recommend 三函数 + admin.html 静态 + migration `20261009091200`（+rollback） |
| PMC-13 发布 | 提交 `9eb03e4`（3 files, +307/-63）；标签 `release-20261009-151917`；部署 activity_speakers/ai_activity 两函数；无 migration；无 admin.html 改动；sync-check 三端全绿。档案发布提交 `50f06d6` 标签 `release-20261009-153902`（云端产物未改变）；**验收登记发布标签以本档案提交的发布时间戳为准** |
| PMC-14 发布 | 提交 `d081a64`（24 files, +880/-26，代码+档案合一）；标签 `release-20261009-203048`；三端一致 PASS（28 函数 170 文件一致）。activities 函数部署（sync-shared 56 副本一致 + WP01 门 PASS）；migration `20261009180000`（+rollback）已应用（AffectedRows=7）+ 双备份 SHA-256 一致；静态文件零改动 |
| PMC-15 发布 | 标签 `release-20261009-231926`；migration `20261009220000`（+守卫 rollback，双备份）；部署 ai_activity/person_360 两函数（sync-shared 一致 + WP01 门 PASS）+ 4 静态模块（50 在线资产 SHA 全一致，admin.html 未改）；生产对账漂移=0（799 角色：customer 779/recruit 15/speaker 4/participant 1；origin legacy_backfill 790/manual 7/derived 2；relationships 0 行） |
| PMC-16 发布 | 标签 `release-20261010-050207`；**零 migration**（零结构变更）；部署 person_360 函数（interaction-service.js 共享母本+副本 SHA 一致，sync-shared 56 副本一致 + WP01 门 PASS）+ admin.html 静态（OCR 恢复闭环；50 在线资产 SHA 全一致）；盘点工具 tools/pmc16-q1~q7-*.sql + tools/parse-tcb-raw.cjs |
| PMC-17 发布 | 标签 `release-20261010-102500`（提交 `46c30d7`，代码+档案合一）；migration A `20261010091000` + migration B `20261010093000`（各含 rollback，双备份）已应用并核对全绿；部署 customers/assistant/person_360 三函数（person-service.js 共享母本+副本同步，WP01 门 PASS）；静态文件零改动；新增 tests/pmc/pmc17-write-boundary.test.cjs（9/9）。验收记录发布标签 `release-20261010-103200`（提交 `81a54ec`，云端产物未改变） |
| PMC-18 发布 | 标签 `release-20261010-120000`（提交含定时监测基建）；migration `20261010115000`（pmc18_observations 表+函数+审计触发器，+rollback 双备份）已应用；部署 pmc18_observer 云函数 + pmc18_daily_0200 定时触发器；T0 基线全绿 |
| PMC-19 发布 | 标签 `release-20261010-161100`（提交 `44b5539`，7 files +1014/-12）；仅文档包，云端产物未改变；新建 pmc-19-cleanup-proposal.md + evidence/PMC-19.md + tools/pmc-19-catalog.sql；更新 decisions/tasks/handoff；三端一致 |
| PMC-19 CL-05/06/01 执行 | 提交 `e40557e`；标签 `release-20261010-163900`；migration `20261010163000`（CL-05 DROP education）+ `20261010163100`（CL-06 DROP mbti）+ `20261010163200`（CL-01 DROP UNIQUE 约束），各含 rollback，双备份；经 cloudbase_postgres 角色应用（8/11/16ms）；post 核对全绿；无云函数/静态文件改动（纯 DB 变更） |
| PMC-19 CL-02~CL-09 执行 | 提交 `0c511db`；标签 `release-20261010-1745`；CL-04 DROP 复合 FK×2（`20261010170600/170610`）；CL-08 DROP 桥触发器+函数（`20261010170700`）；CL-09 DROP recruit 同步触发器+函数（`20261010170800`）；CL-02 重建 11 视图改读 persons + DROP customers 7 副本列 + 更新 6 个 DB 函数（`20261010164000/164100` + 6 个函数迁移）；CL-03 更新 25 个 JS + DROP persons.legacy_customer_id + 重建触发器（`20261010170900/180000/180100`）；部署 5 个云函数（customers/person_360/assistant/ai_activity/today_coach）；post 核对全绿；迁移双目录 130/130 一致 |
| PMC-20 发布 | 提交见 git log（2026-10-10）；标签见 evidence/PMC-20.md §7；3 个坏 DB 函数兼容修复（migration `20261010190000/190100/190200` 各含 rollback，经 cloudbase_postgres 应用 + RPC 验证）+ 12 云函数 4 小批部署（activity_reports/activity_speakers/activity_tasks/ai_activity/ai_parse/ai_recommendations/followups/gifts/photos/products/person_360/today_coach）+ crm/person-360.js hosting（SHA 一致）+ tests/households 夹具适配；隔离测试与 DB 63 项探针与浏览器双前端中英回归全绿；i18n.js/misc.js 为 WIP 未纳入提交 |
| 云端 | PMC-20 部署 12 函数 + person-360.js hosting + 3 DB 迁移；PMC-19 部署 5 函数（customers/person_360/assistant/ai_activity/today_coach）；PMC-17 部署 3 个函数；PMC-16 部署 1 个函数+admin.html 静态；PMC-15 部署 2 函数+4 静态模块；PMC-14 部署 1 函数；PMC-13 部署 2 函数；PMC-12 部署 3 函数+admin.html；PMC-11 部署 8 AI 函数 |
| 数据库迁移 | PMC-17 `20261010091000_pmc17_customers_person_link_backfill`（已应用：3 个无 Person 客户补建关联，customers 782/782 映射）+ `20261010093000_pmc17_customers_person_id_constraints`（已应用：customers.person_id SET NOT NULL、recruit_candidates(person_id) 活跃行部分唯一索引、person_identity_execute_v1/crm_test_scenario_v1 两函数适配）；PMC-15 `20261009220000_pmc15_role_derivation_relationship_governance`（已应用：person_roles origin/role CHECK、relationships 4 治理列+2 CHECK、2 SECURITY DEFINER 函数+5 触发器、重建 crm_search_people_v1、对账删 2 补 2）；PMC-14 `20261009180000_pmc14_participant_canonical_backfill`（已应用，数据回填 7 行软删行 canonical，无结构变更）；G-PMC11-2 修复 `20261009070000`（已应用）；persons anon 只读依赖 PMC-10 `20261008231500`，在效 |
| 数据规模抽查（PMC-16 盘点） | interactions 9 行（全 manual，0 legacy 物化副本）；followups 250（软删 1，5 行姓名漂移=历史快照保留）；opportunities 9（customer 7/person-only 2）；actions 4、commitments 2；products 1、policy_review_reports 2、gifts 189、photos 8、ocr_records 6（含快照 2）；ai_recommendations 26（nba open 25/skipped 1）；11 表孤儿引用全部=0 |

历史基线链：PMC-00 → …→ PMC-11 最终验收通过（`release-20261009-0823`）→ PMC-12（已验收，`release-20261009-141318`）→ PMC-13（已验收，`release-20261009-151917`）→ PMC-14（已验收，`release-20261009-203048`）→ PMC-15（已验收，`release-20261009-231926`）→ PMC-16（已验收，`release-20261010-050207`）→ PMC-17（已验收，`release-20261010-102500`）→ PMC-18（用户授权提前验收，`release-20261010-120000`）→ PMC-19（CL-01~CL-09 全部执行，`e40557e`/`release-20261010-163900` + `0c511db`/`release-20261010-1745`）→ **PMC-20（收官包：清理后复核+回归修复+最终交接，提交与标签见 evidence/PMC-20.md §7）——Person 中心化迁移 PMC-00～PMC-20 全部完成**。

## 3. 各模块读写权威来源与兼容方向

| 模块 | 读/写权威来源 | 兼容方向 |
| --- | --- | --- |
| Person 基础身份 | `public.persons`；解析唯一走服务端 `PersonService.resolveName()` + 人工确认 | 不按姓名/手机号/AI 自动合并；Legacy 各表保留既有身份字段直至各包批准收敛 |
| 客户域 | **人物基础字段权威=`public.persons`（PMC-19 后 customers 7 副本列与 persons.legacy_customer_id 均已物理删除）**：customers 仅保留 person_id(NOT NULL UNIQUE FK→persons.id) + 业务字段（customer_stage/优先级等）；写入统一经 `PersonService.updateBasicsWithProjection` 受控边界（customers.create 直写 person_id）；客户业务字段权威=customers（callFn / customers 函数） | admin.html 单文件实现保留；软删除+同时间戳级联不动；桥触发器已退出（PMC-19 CL-08）、recruit 同步触发器已退出（CL-09）、复合 FK×2 已退出（CL-04）；legacy_customer_id 已删除，关联一律走 customers.person_id（PMC-20 修复 3 个 DB 函数 + 12 云函数运行时引用） |
| 互动 | `interactions`（RLS 仅 service_role；云函数经 person_360 委托）；**PMC-16 起 listInteractions 与 Person 360 时间线同规则**（activeLegacy 防复活过滤 + `source_type:source_id` 去重、账本行优先、来源标识） | Legacy followups 等旧来源继续可写；统一时间线只读映射；同一跟进单条呈现不重复统计 |
| 机会 | `opportunities`（Person 专属与旧 customer 机会隔离） | 旧 customer 机会与漏斗不动 |
| 行动/承诺 | `actions` / `commitments`（新写入走 Service+人工确认） | 旧来源经 `v_action_center` 可见，防重 |
| 招募 | `recruit_candidates` / `recruit_followups` | Legacy 完整保留；PMC-12 起招募视图人物基础 7 列 Person 优先+customers 回退；create 仍强制 customer_id（R-ID1）；Person-only 招募走 person_360 identity command（需 Selected Person）；B 类转化需预览人工确认 |
| AI 上下文（PMC-11 起） | 人物基础 8 字段取 `persons`（经 person_id，未映射回退+禁猜测提示、冲突标注）；销售/招募/保险/互动/活动上下文各取所属业务域 | 历史快照（ai_tasks/ai_runs/ai_results、历史 ai_recommendations 行）保持当时事实不批量改写；派生快照名新写入取 Person 当前名；listAll 双名搜索 |
| AI 审计 | `ai_tasks` / `ai_runs` / `ai_results`（service_role only） | 不照搬旧表匿名 CRUD |
| AI 搜索/身份引用（PMC-11 核实） | assistant 固定模板 + 白名单视图 `public.crm_search_people_v1`，refs 指向 `persons` 准确 ID；模型不生成 SQL、不按姓名自选；**PMC-15 起关系边只认 status=confirmed** | businessDataWritten:false；Command→Plan→Preview→Confirm→Execute 授权链不变 |
| 角色（PMC-15 起） | customer/recruit/speaker/participant=业务事实派生（5 触发器实时重算，origin=derived）；partner/referrer/alumni/other=人工标记；业务阶段读业务表 | 删业务角色只清派生行，不触碰关系/家庭/人工角色；无独立角色缓存 |
| 人与人关系/家庭（PMC-15 起） | relationships=有向 Person 边（source/status/确认门，默认 pending；家庭/投保角色不混入）；households/household_members 家庭域独立 | 当前无应用层写入路径；AI/搜索/会前只消费 confirmed；旧线索候选机制待后续工作包 |
| 前端 | Legacy=admin.html；新 AI-native=crm/console.html + js/modules/console/ | 新功能进模块化体系；不抽离 admin.html |

## 4. 已批准 / 未批准

- 已批准（持续授权）：PMC-00 文档建立与文档发布；常规 Git 提交/推送/标签；针对性部署受影响产物。
- 已批准（2026-10-07）：**PMC-02 数据模型与接口契约设计，D1–D11 全部按建议方案**（D5/D8 为路径批准，约束解除/列退出动作仍须届时单独授权）——见 [data-model.md](data-model.md) §8 与 decisions.md。
- 已批准（2026-10-08）：PMC-11 指令及编码前影响方案（AI 基础资料取 Person、业务域不动、缺失/冲突标注、非模型保存入口改造、历史快照不改写、不扩大自动写权限与 Quick Capture 灰度）；PMC-10 验收修复方案 A（persons anon 只读 GRANT/RLS）。
- 已批准（2026-10-09）：**G-PMC11-2 修复——方案 A 视图 LEFT JOIN 修复 + 回收站视图一并修复**（migration + rollback，已应用并验证）；**PMC-11 最终验收通过**（用户下发「执行最终验收确认」）。
- 已批准（2026-10-09）：**PMC-12 指令与四项裁决**（①视图读切换 Person 优先+customers 回退；②AI 复盘 B 类采纳改预览确认；③旧增员表单保持先匹配客户；④死列 education/mbti 留置登记）；**PMC-12 验收通过**（PASS_WITH_LIMITATIONS，用户下发「执行验收」）。
- 已批准（2026-10-09）：**PMC-13 指令与四项裁决**（①enrichIdentity Person 优先读+customers 回退；②create 去掉自动建 Person+customers 分支；③ai_activity 嘉宾 name Person 优先读；④ensurePersonCustomer 死函数保留不动）；**PMC-13 验收通过**（PASS，用户下发「执行最终验收确认」）。
- 已批准（2026-10-09）：**PMC-14 指令与两项裁决**（①回填含软删行；②展示名 Person 优先+快照保留）+ **生产 UPDATE 专项批准**（7 行软删 customer 参与行回填 canonical，安全层拦截后完整披露映射/影响/回滚再确认，AskUserQuestion"确认执行"）。
- 已批准（2026-10-09）：**PMC-15 指令与五项推荐裁决**（用户预授权"有推荐二字直接选择推荐"：①角色组合模型+派生触发器；②关系治理列与词表/确认 CHECK；③households 不动仅注释；④confirmed-only 消费收紧；⑤断言保护对账删 2 补 2），含经 cloudbase_postgres 角色的生产 DDL 与限定范围 DML（影响与回滚已在 decisions.md/evidence 披露）。
- 已批准（2026-10-10）：**PMC-16 指令与四项推荐裁决**（①11 表归属维持，零 customer_id→person_id 替换、零结构变更；②时间线双轨不重构，补测试锁定 + listInteractions 对齐 activeLegacy 防护；③OCR 恢复闭环仅改 admin.html 前端，冲突 diff+人工确认 forceRestore；④登记项维持：ai_recommendations 无 deleted_at=U7 续登、followups 软删无 batch 1 行不修）——见 decisions.md 2026-10-10 与 evidence/PMC-16.md §2。
- 已批准（2026-10-10）：**PMC-17 指令与两项裁决**（①指令②③「改道受控边界（推荐）」：Legacy customers 写路径统一经 PersonService 受控边界，部署 customers/assistant/person_360 三函数；②指令④约束实施范围：migration A 回填补关联 + migration B 全部内容=两 DB 函数适配+customers 代码部署+customers.person_id 三重约束+recruit 活跃行部分唯一索引，发布顺序先部署 customers 函数代码→再应用 migration B）——见 decisions.md 2026-10-10 与 evidence/PMC-17.md §3/§5。
- 已批准（2026-10-10）：**PMC-19 清理提案制定**（本包仅制定方案，不执行删除/改名/停用/清理；9 项候选 CL-01~CL-09 逐项含证明/变更SQL/恢复方案/回归清单；逐项批准表 9 项均为"待批准"——用户批准本提案≠批准所有清理项）——见 [pmc-19-cleanup-proposal.md](pmc-19-cleanup-proposal.md) §6 与 decisions.md 2026-10-10。
- 已批准（2026-10-10）：**PMC-19 CL-05/CL-06/CL-01 执行（B1+CL-01 全部）**——CL-05 DROP recruit_candidates.education 死列、CL-06 DROP recruit_candidates.mbti 死列、CL-01 DROP customers"客户列表_姓名_key" UNIQUE 约束；各含 migration+rollback 双备份；经 cloudbase_postgres 角色应用；pre/post 核对全绿。详见 evidence/PMC-19.md §10 与 decisions.md 2026-10-10。
- 已批准（2026-10-10）：**PMC-19 全部清理项 CL-01~CL-09 执行**（用户逐项审阅批准表后批准全部；B1+CL-01 先行 `e40557e`，CL-02~CL-09 `0c511db`；各 migration+rollback 双备份，post 核对全绿）——见 evidence/PMC-19.md §10-§14 与 decisions.md 2026-10-10。
- 已批准（2026-10-10）：**PMC-20 指令七项**（清理后复核+回归修复+最终回归+文档终态+发布+Codex handoff；本包无新增清理对象，修复仅限 PMC-19 暴露的运行时回归：3 个坏 DB 函数 + 12 云函数 + person-360.js + tests/households 夹具）——见 evidence/PMC-20.md 与 decisions.md 2026-10-10。
- 未批准：PMC-21 及一切新工作包（指令未收到，不自行开包）；relationships pending 候选写入路径/确认 UI；G-PMC11-1 修复、G-PMC14-1 修复、G-PMC17-1 白名单扩充、console FAB aria-label 国际化（均只登记）；任何新删除/重命名已有对象；`pr`/`pr_*` 相关一切；Legacy Quick Capture 流程变更；所有数据库变更（需 migration/rollback + 针对性确认）。

## 5. 已登记缺口（观察项，非阻塞；修复须另获授权）

> 2026-10-07 用户指示处置；处置结果见 evidence/PMC-00.md 第九节。

| # | 缺口 | 处置结果（2026-10-07） |
| --- | --- | --- |
| G1 | ~~外部迁移双备份滞后~~ | **已关闭（2026-10-07）**：用户授权后 `tools/sync-migration-backup.ps1` 执行成功——25 份旧稿/分叉稿非破坏性移入 `C:\Users\victor\cloudbase\migrations\_archive-20261007\`，本地 82 份全部镜像，脚本哈希自检 `[PASS] 82 files`；随后独立复核 local=82/external=82、mismatches=0 |
| G2 | `tcb -v` 触发意外交互式部署计划 | **已修复**：`tools/tcb.ps1` 增加显式子命令守卫（无命令/首参数为 flag 即拒绝）；已双向验证（`-v` 两种调用方式均拦截，`fn list` 正常） |
| G3 | cloudbase-mcp 未注册为 Trae 会话可调用工具 | **已修复**：新增 `tools/pg-readonly.cjs`——Trae/Codex 共用，经本机 cloudbase-mcp 执行单条 SELECT/WITH 只读查询；客户端拒绝 DDL/DML/多语句；已验证正常查询与三类拒绝路径。IDE 内 MCP 注册仍为可选项 |
| G4 | 称静态爬虫不覆盖 console.html 模块链 | **核实为过时记录，已更正**：`tests/wp01/static.cjs` 的 PAGES 早已含 `console.html`（WP2 加入）；50 个受检资产 = 2 HTML + 48 个 console 模块链 JS/CSS；两次 sync-check 实测全绿。无需改代码 |
| G-PMC11-1 | `ai_activity` analyze action 的 top3/no_followup 清洗只做 parseInt，未按真实参与者 ID 白名单过滤，模型编造 ID 会透传（participantReview/postReview 已有白名单） | **已登记未修（2026-10-09）**：既有缺陷、非 PMC-11 引入；隔离测试锁定现状。修复（同款白名单清洗）须单独授权。见 evidence/PMC-11.md §11 |
| G-PMC11-2 | 独立候选人（customer_id 为空）被 `v_recruit_candidates` 视图 INNER JOIN customers 过滤，recruit_recommend/recruit_score 对其返回「candidate not found」（git 证据：cbad9aa 已存在，非 PMC-11 回归） | **已修复（2026-10-09，验收中发现并经用户批准）**：migration `20261009070000_fix_v_recruit_candidates_left_join.sql` + rollback，两视图（主视图+trash）改 LEFT JOIN customers + LEFT JOIN persons，customer_name 改 `COALESCE(c.customer_name, p.display_name)`，列名/列序/类型不变，security_invoker/GRANT 不变；验证：14→15 行零差异、trash 3 行一致、浏览器真实链路（候选人 20 增员话术生成成功）PASS、隔离测试复跑 19/19。详见 evidence/PMC-11.md §11 |
| G-PMC12-1 | `recruit_candidates.education/mbti` 死列（0 非空、无函数写入者；PMC-12 开包盘点） | **已关闭（2026-10-10，PMC-19 CL-05/CL-06 执行）**：两列已 DROP，migration `20261010163000`/`20261010163100`（+rollback 双备份），经 cloudbase_postgres 角色应用；视图 education 读 COALESCE(p.education, c.education) 仍正常（15 行活跃）、mbti 保持 customers。见 evidence/PMC-19.md §10 |
| G-PMC14-1 | `tests/pmc/pmc11-identity.test.cjs` 3 个 recruit 用例失败：PMC-12（522fbca）将 recruit_recommend/recruit_score 的 candidate_id String 化（R-ID1），pmc11 fixture 仍用数字 candidate_id，FakeQuery 严格相等不命中（recruit_recommend ×2、recruit_score ×1） | **已登记未修（2026-10-09，PMC-14 全量复跑发现）**：干净 HEAD stash 验证为 PMC-12 遗留、非 PMC-14 引入；生产代码无恙（DB 侧字符串参数与 int8 比较正常）。修复=fixture 数字改字符串，属测试文件变更，须单独授权（规则 11 只记录不修）。见 evidence/PMC-14.md §7 |
| G-PMC17-1 | `crm_test_scenario_v1` 触发器守卫白名单滞后：customers 表存在非白名单 AFTER 触发器（原 4 个=桥触发器+PMC-15 三个派生触发器；**PMC-19 CL-08 后剩 3 个派生触发器**），scenario 种子 INSERT 会被守卫拦截 | **已登记未修（2026-10-10，PMC-17 migration B 适配时发现）**：既有潜在状态，非清理引入；PMC-19 CL-08 删除桥触发器后拦截面已缩小但未消除。扩充白名单属测试基建变更，须单独授权。见 evidence/PMC-17.md §5.5 |

## 6. 失败与未验证项

- PMC-20 无失败项；限制（evidence/PMC-20.md §8）：①平台层自动备份控制台核实+真实恢复演练未执行（本包以只读 SQL 恢复演练替代：CL-03 恢复链 783/783 含软删行实测可回填）；②`fn invoke` 真实调用未验证（tcb CLI Cam 认证失败，功能等价由 DB RPC+浏览器真实链路覆盖）；③AI 摘要/会前准备/对话策略按钮真实模型调用未执行（避免模型成本，链路经 #/ai/search 端到端验证）；④复制电话/微信按钮未实测剪贴板（王寻寻无该数据，disabled 正确）；⑤基线遗留测试失败如实登记（context-engine/person-service/actions/quick-capture-v2/interactions/commitments/wp01——0c511db 及更早遗留，stash 干净 HEAD 复验同样失败，修复须单独授权）；⑥console FAB aria-label 固定中文（i18n 小缺口，只记录）。
- PMC-19 执行无失败项；CL-02/CL-03 执行后暴露 3 个 DB 函数运行时坏引用（actions_guard/crm_person_roles_derive_v1/crm_search_people_v1——函数体内动态引用已删列，静态扫描漏项），由 PMC-20 修复并验证。限制：迁移历史中 CL-02 函数迁移为 `202610101640xx` 系列、CL-03 为 `2026101017xx/18xx` 系列，全部含 rollback 且双目录备份一致。
- PMC-17 无失败项；限制（evidence/PMC-17.md §7.7）：①~~桥触发器/recruit 同步触发器保留~~ **已随 PMC-19 CL-08/CL-09 退出**；②~~D5 姓名唯一约束解除、D8 customer_id 列退出本包不实施~~ **D5 已随 CL-01 退出**；③G-PMC17-1 登记未修、G-PMC11-1/G-PMC14-1 维持登记；④WP01 开放项 login/service-runtime/live-writes/mobile 既定未验证，无 iPad 真机性能复测；⑤性能无历史同口径基线，本包实测建立基线（列表 17ms/搜索 22ms/统计 37ms/招募 13ms）；⑥relationships pending 候选写入路径属后续工作包。
- PMC-16 无失败项；限制（evidence/PMC-16.md §6/§7）：①iPad 生产浏览器 OCR 冲突 diff 人工路径深度回归已由用户验收关闭；②followups 软删无 batch 1 行与 ai_recommendations 无 deleted_at 维持登记（不修）；③G-PMC14-1 保持登记（全量 175 中 3 项既有失败，基线同）。
- PMC-15 无失败项；限制（evidence/PMC-15.md §9）：①iPad 生产浏览器深度回归（角色 badge、多角色筛选）已由用户验收关闭；②relationships 无写入路径，pending 候选生产与确认 UI 属后续工作包；③G-PMC14-1 保持登记（全量 168 中 3 项既有失败，基线同）。
- PMC-14 无失败项；限制（evidence/PMC-14.md §9）：①受控浏览器生产深度回归未做（需登录，按 PMC-13 先例留待用户 iPad 验收；隔离面已覆盖：PMC-14 11/11+regression 94 项+WP04）；②G-PMC14-1（pmc11 fixture 3 用例失败）登记未修；③1 行软删 speaker 参与行与 4 行无 person_id 暂存行保持"身份待确认"（设计行为，非缺陷）。
- PMC-12 无失败项；限制（evidence/PMC-12.md §9）：S5 AI 复盘 B 类采纳预览浏览器实测 BLOCKED（库内无 B 类建议行+IDE 超时，代码契约 T9 覆盖）、招募删除/恢复线上演练未做（RPC recruit 分支零改动+T4/T5 覆盖）。
- PMC-11 无失败项：8 函数部署成功、隔离测试 19/19、真实模型 ai_referral 1 条 PASS；独立候选人缺陷为实施中发现并已修复（evidence §7）。
- PMC-11 未验证项（详见 evidence/PMC-11.md §9）：① ~~ai_recommendations listAll 双名搜索生产前端未实测~~ **已关闭（2026-10-09 验收 PASS）**；② recruit_score、ai_followup、policy_review_reports、ai_recommend 真实模型链路未调用（仅隔离验证）；~~recruit_recommend~~ **已关闭（G-PMC11-2 修复后候选人 20 真实生成 PASS）**；③ ai_activity 全 action 无虚构测试活动、未真实模型验证；④ Console assistant 拒绝路径本轮未实测（静态白名单+GUIDANCE 确认）；⑤ postReviewV2 未真实调用；⑥ ~~iPad AI 弹层人工回归~~ **已关闭（增员话术保留项经浏览器真实链路 PASS，不再阻塞）**。
- PMC-00 范围内无失败项。G1–G4 缺口均已关闭。
- 其他历史未验证项：全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。

## 8. Codex 接管必读（PMC-20 终态交接，2026-10-10）

### 8.1 最后验证基线与环境

| 项 | 值 |
| --- | --- |
| 最后验证时间 | 2026-10-10（隔离测试 + DB 只读探针 + 生产浏览器回归同日完成） |
| 提交 | PMC-19 执行 `e40557e` + `0c511db`；PMC-20 发布提交与 handoff 提交见 `git log --oneline -5` |
| 标签 | `release-20261010-163900`（B1+CL-01）、`release-20261010-1745`（CL-02~CL-09）、PMC-20 标签见 evidence/PMC-20.md §7 |
| 生产环境 | CloudBase `crm-d1gkae8ddc930d151`（envId）；仅 public schema |
| 线上入口 | admin：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`；console：`…/crm/console.html` |
| 数据规模 | persons 787（活跃 784）；customers 783（活跃 782，person_id 0 缺失 0 重复）；recruit 15；speakers 4；interactions 9；followups 249；actions 4；gifts 189；photos 8；回收站 customers 1/persons 3/recruit 3/followups 1 |

### 8.2 已执行与未执行的清理项及批准证据

- **已执行（全部经用户逐项批准，见 pmc-19-cleanup-proposal.md §6 批准表 + evidence/PMC-19.md §10-§14）**：CL-01 customers UNIQUE(customer_name)；CL-02 customers 7 副本列+11 视图重建+6 DB 函数；CL-03 persons.legacy_customer_id+25 JS 改道；CL-04 复合 FK×2；CL-05 recruit.education；CL-06 recruit.mbti；CL-07 无需操作；CL-08 桥触发器+函数；CL-09 recruit 同步触发器+函数。
- **未执行（无未获批暗中清理）**：PMC-20 无新增清理对象；未批准项见 §4「未批准」。
- PMC-19 静态扫描漏项的教训：函数体内动态 SQL 引用不会被列级依赖捕获——PMC-20 以函数体文本扫描补查并修复 3 个坏函数（actions_guard/crm_person_roles_derive_v1/crm_search_people_v1）。**后续任何 DROP COLUMN 前必须做函数体文本扫描**（tools/pmc20-procs-audit*.sql 可复用）。

### 8.3 Person 与各领域表字段归属（终态）

| 域 | 表 | 人物基础字段 | 领域字段（留在本表） | 关联 |
| --- | --- | --- | --- | --- |
| 人物主实体 | persons | display_name/gender/birthday/phone/wechat/occupation/organization/education/notes 等（权威） | — | id 为全系统人物主键 |
| 客户 | customers | ~~7 副本列已删~~ | customer_stage/sales_priority/recruitment_priority/referral_priority/source/annual_income/household_income/properties_info/marital_status/hobbies/mbti/additional_info/tags/first_contact_date 等业务字段 | person_id NOT NULL UNIQUE FK→persons.id |
| 招募 | recruit_candidates | ~~education/mbti 死列已删~~ | 招募阶段/意愿/评估/推进/potential_score 等 | person_id NOT NULL（活跃行部分唯一索引）；create 仍强制 customer_id（R-ID1） |
| 嘉宾 | activity_speakers | name/phone/wechat/organization 读 Person（enrichIdentity） | 合作阶段/擅长主题/合作记录 | linked person_id |
| 参与者 | activity_participants | canonical_person_id（权威关联）+ person_name 快照 | status/participant_role/followup_status | canonical_person_id→persons.id |
| 关系 | relationships | — | source/status/confirmed_at/confirmed_by_uid/类型词表/trend | from/to_person_id→persons.id（仅 confirmed 可消费） |
| 家庭 | households / household_members | — | important_facts（≤2000 字）/relationship_to_anchor | anchor_person_id / person_id→persons.id（人工确认） |
| 互动 | interactions | person_id 直连 Person | summary/raw_note/interaction_type 等 | person_id→persons.id |
| 保险/附件 | products/policy_review_reports/gifts/photos/ocr_records | — | 各自业务字段 | customer_id（业务主体为客户）；ocr_records.customer_snapshot 为 D6 批准历史快照 |
| 机会/行动 | opportunities/actions/commitments | — | 业务字段 | customer_id 或 person_id（按业务主体） |
| 角色 | person_roles | — | role/origin（derived/manual/legacy_backfill） | person_id；业务角色由 5 触发器实时派生 |

完整字段字典见 [data-model.md](data-model.md) §2；接口契约 C1-C9/T1-T3 同文件 §6。

### 8.4 当前函数/action、数据库函数、视图和共享副本关系

- 云函数 28 个（含 pmc18_observer）；逐函数×action 清单见 impact-matrix.md 与 evidence/PMC-17.md §7 盘点。callFn 为唯一前端数据入口。
- DB 函数 35+（RPC：crm_customers_page_v1、person_directory_page_v1、crm_search_people_v1（三模板）、person_identity_preview_v1/execute_v1、crm_person_roles_derive_v1、crm_person_role_sync_v1、crm_test_scenario_v1、pmc18_collect_metrics、actions_guard 触发器函数等）；触发器含 PMC-15 三个派生触发器 + crm_person_role_persons_sync（deleted_at 列级）+ pmc18 审计触发器。
- 12 视图：customers_view、v_action_center、v_funnel_stats、v_recruit_candidates（+trash）等，全部已改读 persons（PMC-19 CL-02）。
- 共享模块：11 模块 73 副本，母本在 `cloudfunctions/_shared/`，经 `npm run build:shared` 同步、`npm run check:shared` 校验（PMC-20 后 58 副本核对一致——部分模块间共享同一文件）。修改共享模块后必须同步受影响副本并逐个部署。

### 8.5 仍保留的兼容行为、历史字段及保留理由（D6 批准快照，不属于冗余）

| 保留项 | 位置 | 理由 |
| --- | --- | --- |
| activity_participants.person_name | 参与行 | 历史活动"当时姓名"快照；canonical_person_id 为权威关联 |
| activity_speakers 机构/职务快照列 | 嘉宾记录 | 某次活动的当时职务属历史证据，Person 当前职业不覆盖 |
| ocr_records.customer_snapshot | OCR 记录 | OCR 恢复闭环的唯一恢复依据；删除即销毁恢复能力 |
| 子表 customer_name（followups 等旧来源） | 跟进/礼物等 | Legacy 来源的当时姓名；展示经 Person 优先映射，不回写 |
| customers.mbti | customers | 业务域字段（PMC-12 裁决：性格自评属客户经营资料，非人物客观事实） |
| followups 5 行姓名漂移 | followups | 历史事实不批量改写（PMC-16 裁决） |
| Legacy followups 写路径 | 云函数 | 旧来源继续可写，统一时间线只读映射去重 |
| admin.html 单文件实现 | 前端 | 规则 13：旧实现保留，新 AI-native 功能进 crm/js/modules/ |

### 8.6 实际测试结果、未验证项和待处理问题

- **通过**：隔离测试 households 5/5（CL-03 新契约）、ai-gateway 14/14、ai-skills 7/7、recruit-goals 3/3、modular PASS、check:shared PASS；DB 63 项探针全绿（12 视图/RPC/回收站/富客户/3 搜索模板）；生产浏览器 console+admin 双前端中英全绿、0 console 错误（清单见 evidence/PMC-20.md §6）。
- **未验证**（§6 指令④要求如实标注）：见 §6 PMC-20 限制①-⑥。关键：平台层真实备份/恢复演练、`fn invoke`、AI 按钮真实模型调用。
- **待处理（登记未修，修复须单独授权）**：G-PMC11-1（ai_activity ID 白名单）、G-PMC14-1（pmc11 fixture）、G-PMC17-1（scenario 白名单）、基线遗留测试失败清单、console FAB aria-label 国际化、followups 软删无 batch 1 行、ai_recommendations 无 deleted_at。

### 8.7 备份索引、恢复限制和操作入口

- **迁移双目录**：`cloudbase/migrations`（本地，Git 管理）+ `C:\Users\victor\cloudbase\migrations`（外部镜像，130/130 SHA 一致）；每个 migration 同名 `.rollback.sql`。
- **恢复入口**：DDL 执行 `node tools/tcb-exec.cjs --file <sql> --role cloudbase_postgres`；只读查询 `--role service_role`（均需禁用沙箱）。rollback 按迁移时间倒序逆序执行。
- **恢复限制**：①CL-03 恢复链有顺序（180000→170900→180100，见 §1 回滚条件）；②恢复脚本以 customers.person_id 现值为回填源，清理后新增数据天然被覆盖保护；③平台层 PITR 未演练，真实恢复能力以 §8.6 未验证项为准；④CRM 使用无前缀云函数，禁触 pr/pr_*。
- **观察工具**：pmc18_observations 表（每日 02:00 采集）+ `SELECT * FROM public.pmc18_collect_metrics()` 手动执行；migration-check（`node tools/migration-check.cjs`）。

### 8.8 后续开发必须遵守的约定 + 下一项允许开展的工作

**约定（AGENTS.md 全文有效，此处列接管易错点）**：

1. 仅 public schema；不访问/依赖 pr、pr_*。
2. 不删除/重命名已有表、视图、函数、Routes，除非用户针对该项单独批准。
3. 数据库变更必须 migration + rollback 双份，双目录备份；**DROP COLUMN 前必须函数体文本扫描**（§8.2 教训）。
4. 基表改列必须检查并重建依赖视图（本项目列表/详情查询走 v_* 视图）。
5. 云函数共享模块有独立副本，修改后同步受影响副本并逐个部署；不全量部署。
6. AI 功能不硬编码模型厂商，模型选择经 AI Gateway/CloudBase 配置；AI 写操作走 Command→Plan→服务端核实 Preview→人工 Confirm→有范围授权 Execute。
7. Quick Capture 新建/关联 Person 必须经服务端 resolveName + 人工确认。
8. 页面布局默认只考虑 iPad；新功能必须中英双语（i18n.js 字典 + t(key)），默认简体中文。
9. 每轮修改完成即发布（Git 提交推送+标签+三端核对）；失败立即停止收尾。
10. 不拿真实客户数据做破坏性测试；业务验证未执行必须如实报告。
11. Legacy 功能优先保留；发现额外问题只记录不修（规则 11）。
12. 发布命令与环境细节见 `docs/development-environment.md`；Git 推送用 `git -c http.proxy=http://127.0.0.1:7897 -c http.sslBackend=schannel push origin master`。

**下一项唯一允许开展的工作（白名单）**：

1. **PMC-18 定时监测例行处理**：pmc18_observations 异常 → 按修复包流程处理（先报告影响与授权）。
2. **等待用户下发新指令**：不默认继续旧计划、不自行开新工作包。已登记的可选方向（均须用户指令才启动）：relationships pending 候选写入路径/确认 UI；G-PMC11-1/G-PMC14-1/G-PMC17-1 修复；基线遗留测试修复；console FAB aria-label 国际化；i18n.js/misc.js WIP 收尾（当前工作树未提交，属未完成状态，接手后须先向用户确认处置）。
