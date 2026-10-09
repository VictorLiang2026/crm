# Handoff（接管状态）

更新时间：2026-10-09（**PMC-15 已实施并发布，等待用户验收；PMC-16 指令未收到**）。任何工具接手前先读本文件与 execution-contract。

## 1. 执行状态

| 项 | 值 |
| --- | --- |
| 当前执行工具 | Trae；PMC-15 已发布待验收，等待用户验收/PMC-16 指令 |
| 最后验收通过包 | **PMC-14（互动参与者和活动参与者统一人物身份）——2026-10-09 用户 iPad 人工验收确认「都OK」（PASS）**：两项裁决全部落地（①回填含软删行：migration AffectedRows=7，7 行软删 customer 参与行经专项批准回填 canonical；②Person 优先+快照保留：activities enrichParticipants canonicalPersonId 字符串输出+展示名 Person 优先+D6 快照不可变）；activities 函数已部署；隔离测试 11/11；migration q10-final 核对全符合预期；regression 94 项 PASS；WP04 PASS_WITH_EXCEPTIONS；WP01 门 PASS；受控浏览器生产深度回归（活动参与流程、活动统计、互动对象、人物时间线）用户 iPad 实测全 OK。限制项 L1–L3 均非阻塞（L1 已关闭=用户 iPad 验收 OK、L2 G-PMC14-1 登记未修、L3 5 行身份待确认为设计行为）。详见 evidence/PMC-14.md §14 |
| 正在执行包 | 无（PMC-15 已发布 `release-20261009-231926`，待用户验收；PMC-16 指令未收到） |
| 下一步唯一允许执行的动作 | **等待用户对 PMC-15 的验收或 PMC-16 指令**；relationships pending 候选写入路径、G-PMC11-1/G-PMC12-1/G-PMC14-1 修复须单独授权 |
| 回滚条件 | PMC-15：`cloudbase/rollbacks/20261009220000_pmc15_role_derivation_relationship_governance.rollback.sql`（守卫式：逆对账恢复 703/792、删 777 补入行→DROP 5 触发器/2 函数/4 列→复原 origin CHECK）；代码用上一发布标签重新部署 ai_activity/person_360 与 4 静态模块。PMC-14 数据回滚：`cloudbase/rollbacks/20261009180000_pmc14_participant_canonical_backfill.sql`（按精确 id+预期值清 canonical，不动既有 2 行人工确认值）；代码回滚：`git revert d081a64`（本包提交）→ 重新部署 activities 函数。PMC-13 代码回滚：`git revert 9eb03e4` → 重新部署 activity_speakers/ai_activity 两函数；无结构/数据回滚（本包无 migration）。PMC-12 结构回滚：`cloudbase/rollbacks/20261009091200_pmc12_recruit_view_person_read.sql`；G-PMC11-2 结构回滚：`cloudbase/rollbacks/20261009070000_fix_v_recruit_candidates_left_join.sql` |

## 2. 版本基线（2026-10-09 PMC-13 发布时更新）

| 端 | 值 |
| --- | --- |
| PMC-11 前基线 | `master` @ `cbad9aa`（PMC-10 验收提交，标签 `release-20261008-2311`），工作树干净 |
| PMC-11 发布 | 标签 `release-20261009-0105`（时间戳）+ `v2.1.2`（2026-10-09 首提交 semver，patch：AI 适配向后兼容）；G-PMC11-2 修复标签 `release-20261009-0808`；**最终验收登记标签 `release-20261009-0823`** |
| PMC-12 发布 | 提交 `522fbca`（20 files, +797/-52）；标签 `release-20261009-141318`；部署 recruit_candidates/recruit_score/recruit_recommend 三函数 + admin.html 静态 + migration `20261009091200`（+rollback） |
| PMC-13 发布 | 提交 `9eb03e4`（3 files, +307/-63）；标签 `release-20261009-151917`；部署 activity_speakers/ai_activity 两函数；无 migration；无 admin.html 改动；sync-check 三端全绿。档案发布提交 `50f06d6` 标签 `release-20261009-153902`（云端产物未改变）；**验收登记发布标签以本档案提交的发布时间戳为准** |
| PMC-14 发布 | 提交 `d081a64`（24 files, +880/-26，代码+档案合一）；标签 `release-20261009-203048`；三端一致 PASS（28 函数 170 文件一致）。activities 函数部署（sync-shared 56 副本一致 + WP01 门 PASS）；migration `20261009180000`（+rollback）已应用（AffectedRows=7）+ 双备份 SHA-256 一致；静态文件零改动 |
| PMC-15 发布 | 标签 `release-20261009-231926`；migration `20261009220000`（+守卫 rollback，双备份）；部署 ai_activity/person_360 两函数（sync-shared 一致 + WP01 门 PASS）+ 4 静态模块（50 在线资产 SHA 全一致，admin.html 未改）；生产对账漂移=0（799 角色：customer 779/recruit 15/speaker 4/participant 1；origin legacy_backfill 790/manual 7/derived 2；relationships 0 行） |
| 云端 | PMC-15 部署 2 个函数（ai_activity/person_360）+4 静态模块；PMC-14 部署 1 个函数（activities）；静态文件零改动；PMC-13 部署 2 个函数（activity_speakers/ai_activity）；PMC-12 部署 3 函数+admin.html；PMC-11 部署 8 AI 函数 |
| 数据库迁移 | PMC-15 `20261009220000_pmc15_role_derivation_relationship_governance`（已应用：person_roles origin/role CHECK、relationships 4 治理列+2 CHECK、2 SECURITY DEFINER 函数+5 触发器、重建 crm_search_people_v1、对账删 2 补 2）；PMC-14 `20261009180000_pmc14_participant_canonical_backfill`（已应用，数据回填 7 行软删行 canonical，无结构变更）；G-PMC11-2 修复 `20261009070000`（已应用）；persons anon 只读依赖 PMC-10 `20261008231500`，在效 |
| 数据规模抽查（PMC-15 实施后） | person_roles 799 行（派生漂移 stale/missing/软删人物挂派生 =0；5 触发器在）；relationships 0 行、4 治理列齐备；households/household_members 结构未变 |

历史基线链：PMC-00 → …→ PMC-11 最终验收通过（`release-20261009-0823`）→ PMC-12（已验收，`release-20261009-141318`）→ PMC-13（已验收，`release-20261009-151917`）→ PMC-14（已验收，`release-20261009-203048`）→ **PMC-15（角色及关系治理，已发布待验收，`release-20261009-231926`）**。

## 3. 各模块读写权威来源与兼容方向

| 模块 | 读/写权威来源 | 兼容方向 |
| --- | --- | --- |
| Person 基础身份 | `public.persons`；解析唯一走服务端 `PersonService.resolveName()` + 人工确认 | 不按姓名/手机号/AI 自动合并；Legacy 各表保留既有身份字段直至各包批准收敛 |
| 客户域 | `customers` 等客户表（callFn / customers 函数） | admin.html 单文件实现保留；软删除+同时间戳级联不动 |
| 互动 | `interactions`（RLS 仅 service_role；云函数经 person_360 委托） | Legacy followups 等旧来源继续可写；统一时间线只读映射 |
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
- 未批准：PMC-16～PMC-20 全部实施包（指令未收到）；relationships pending 候选写入路径/确认 UI；G-PMC11-1 修复、G-PMC12-1 处置、G-PMC14-1 修复；一切删除/重命名已有对象（含 D5 姓名唯一约束解除、D8 customer_id 列/复合 FK 退出——须独立包单独批准）；`pr`/`pr_*` 相关一切；Legacy Quick Capture 流程变更；所有数据库变更（需 migration/rollback + 针对性确认）。

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
| G-PMC12-1 | `recruit_candidates.education/mbti` 死列（0 非空、无函数写入者；PMC-12 开包盘点） | **已登记未修（2026-10-09，PMC-12 裁决④留置）**：视图 education 读 COALESCE(p.education, c.education)（c 恒空）、mbti 保持 customers；处置待 D5/D8 约束解除包，须单独授权。见 evidence/PMC-12.md §11 |
| G-PMC14-1 | `tests/pmc/pmc11-identity.test.cjs` 3 个 recruit 用例失败：PMC-12（522fbca）将 recruit_recommend/recruit_score 的 candidate_id String 化（R-ID1），pmc11 fixture 仍用数字 candidate_id，FakeQuery 严格相等不命中（recruit_recommend ×2、recruit_score ×1） | **已登记未修（2026-10-09，PMC-14 全量复跑发现）**：干净 HEAD stash 验证为 PMC-12 遗留、非 PMC-14 引入；生产代码无恙（DB 侧字符串参数与 int8 比较正常）。修复=fixture 数字改字符串，属测试文件变更，须单独授权（规则 11 只记录不修）。见 evidence/PMC-14.md §7 |

## 6. 失败与未验证项

- PMC-15 无失败项；限制（evidence/PMC-15.md §9）：①iPad 生产浏览器深度回归（角色 badge、多角色筛选）留用户验收（服务端由 s11/s12/s13+静态 SHA 覆盖）；②relationships 无写入路径，pending 候选生产与确认 UI 属后续工作包；③G-PMC14-1 保持登记（全量 168 中 3 项既有失败，基线同）。
- PMC-14 无失败项；限制（evidence/PMC-14.md §9）：①受控浏览器生产深度回归未做（需登录，按 PMC-13 先例留待用户 iPad 验收；隔离面已覆盖：PMC-14 11/11+regression 94 项+WP04）；②G-PMC14-1（pmc11 fixture 3 用例失败）登记未修；③1 行软删 speaker 参与行与 4 行无 person_id 暂存行保持"身份待确认"（设计行为，非缺陷）。
- PMC-12 无失败项；限制（evidence/PMC-12.md §9）：S5 AI 复盘 B 类采纳预览浏览器实测 BLOCKED（库内无 B 类建议行+IDE 超时，代码契约 T9 覆盖）、招募删除/恢复线上演练未做（RPC recruit 分支零改动+T4/T5 覆盖）。
- PMC-11 无失败项：8 函数部署成功、隔离测试 19/19、真实模型 ai_referral 1 条 PASS；独立候选人缺陷为实施中发现并已修复（evidence §7）。
- PMC-11 未验证项（详见 evidence/PMC-11.md §9）：① ~~ai_recommendations listAll 双名搜索生产前端未实测~~ **已关闭（2026-10-09 验收 PASS）**；② recruit_score、ai_followup、policy_review_reports、ai_recommend 真实模型链路未调用（仅隔离验证）；~~recruit_recommend~~ **已关闭（G-PMC11-2 修复后候选人 20 真实生成 PASS）**；③ ai_activity 全 action 无虚构测试活动、未真实模型验证；④ Console assistant 拒绝路径本轮未实测（静态白名单+GUIDANCE 确认）；⑤ postReviewV2 未真实调用；⑥ ~~iPad AI 弹层人工回归~~ **已关闭（增员话术保留项经浏览器真实链路 PASS，不再阻塞）**。
- PMC-00 范围内无失败项。G1–G4 缺口均已关闭。
- 其他历史未验证项：全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。
