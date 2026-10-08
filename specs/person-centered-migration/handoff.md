# Handoff（接管状态）

更新时间：2026-10-09（PMC-11 开发完成待验收）。任何工具接手前先读本文件与 execution-contract。

## 1. 执行状态

| 项 | 值 |
| --- | --- |
| 当前执行工具 | Trae，2026-10-09 完成 PMC-11 开发与发布，等待验收 |
| 最后验收通过包 | **PMC-10（Today、任务、漏斗和统计的身份来源统一）——已验收**：v_action_center 展示名经 persons COALESCE；today_coach/activity_reports/activity_tasks JS 层覆盖；验收中发现 persons 匿名读权限缺口并经用户特批修复（migration 20261008231500：GRANT SELECT anon + RLS 策略 deleted_at IS NULL），复测通过 |
| 正在执行包 | **PMC-11（AI 上下文、搜索及结果保存适配 Person）——验收执行完成，PASS_WITH_EXCEPTIONS，待用户最终确认**：8 个 AI 函数 Person 化已部署 + context-engine v1.1.0 两副本；隔离测试 19/19；2026-10-09 受控浏览器验收：AI 建议列表搜索 PASS、转介绍弹层 PASS（前轮同部署证据）、增员话术真实链路已触达（候选人 20 被既有缺陷 G-PMC11-2 拦截，候选人 19 生成项留 iPad）；验收中浏览器代理误点删除确认框，经只读核查**零数据影响**（候选人 19/20、客户 788/791/792、Person 783-786 全部完好，证据 tests/security/.results/pmc11-*-state.json） |
| 下一步唯一允许执行的动作 | 等待用户对 PMC-11 验收结论（PASS_WITH_EXCEPTIONS）做最终确认；用户可在 iPad 真机打开**候选人 19**（不要用候选人 20，被 G-PMC11-2 拦截）→ AI 增员话术 tab → 生成话术做最后人工确认（约 30 秒）；确认前不得进入 PMC-12；G-PMC11-1、G-PMC11-2 修复均须单独授权 |
| 回滚条件 | PMC-11 代码回滚：git revert → 重新部署上述 8 函数（context-engine 副本随 ai_activity 回滚）；无结构/数据回滚（本包无 migration、无业务数据写入） |

## 2. 版本基线（2026-10-09 PMC-11 发布时更新）

| 端 | 值 |
| --- | --- |
| PMC-11 前基线 | `master` @ `cbad9aa`（PMC-10 验收提交，标签 `release-20261008-2311`），工作树干净 |
| PMC-11 发布 | 标签 `release-20261009-0105`（时间戳）+ `v2.1.2`（2026-10-09 首提交 semver，patch：AI 适配向后兼容）；提交与三端一致性以发布后 sync-check 记录为准 |
| 云端 | 本包部署 8 个 AI 函数（ai_activity/ai_recommend/ai_referral/ai_followup/policy_review_reports/recruit_score/recruit_recommend/ai_recommendations）；静态文件零改动（admin.html SHA 不变）；无 migration |
| 数据库迁移 | 无新增（本包无 DB 变更；persons anon 只读依赖 PMC-10 `20261008231500`，在效）。本地 `cloudbase/migrations/` 82 份基线不变 |
| 数据规模抽查（PMC-11 只读） | customers 未软删 782 行，779 行已映射 person_id；persons 未软删 781 行；已映射双源姓名冲突 0；recruit_candidates 15/15 有 person_id（candidate 20 为独立候选人，正常） |

历史基线链：PMC-00（`release-20261007-1153`/`-1209` `4a700a1`）→ G1–G4 处置（`-125802` 等）→ PMC-01（`release-20261007-193230` `42787ff`）→ PMC-02~09 → PMC-10（`release-20261008-2311` `cbad9aa`）→ PMC-11（`release-20261009-0105` + `v2.1.2`）。

## 3. 各模块读写权威来源与兼容方向

| 模块 | 读/写权威来源 | 兼容方向 |
| --- | --- | --- |
| Person 基础身份 | `public.persons`；解析唯一走服务端 `PersonService.resolveName()` + 人工确认 | 不按姓名/手机号/AI 自动合并；Legacy 各表保留既有身份字段直至各包批准收敛 |
| 客户域 | `customers` 等客户表（callFn / customers 函数） | admin.html 单文件实现保留；软删除+同时间戳级联不动 |
| 互动 | `interactions`（RLS 仅 service_role；云函数经 person_360 委托） | Legacy followups 等旧来源继续可写；统一时间线只读映射 |
| 机会 | `opportunities`（Person 专属与旧 customer 机会隔离） | 旧 customer 机会与漏斗不动 |
| 行动/承诺 | `actions` / `commitments`（新写入走 Service+人工确认） | 旧来源经 `v_action_center` 可见，防重 |
| 招募 | `recruit_candidates` / `recruit_followups` | Legacy 完整保留；Person-only 招募待 WP13/PMC 相关包 |
| AI 上下文（PMC-11 起） | 人物基础 8 字段取 `persons`（经 person_id，未映射回退+禁猜测提示、冲突标注）；销售/招募/保险/互动/活动上下文各取所属业务域 | 历史快照（ai_tasks/ai_runs/ai_results、历史 ai_recommendations 行）保持当时事实不批量改写；派生快照名新写入取 Person 当前名；listAll 双名搜索 |
| AI 审计 | `ai_tasks` / `ai_runs` / `ai_results`（service_role only） | 不照搬旧表匿名 CRUD |
| AI 搜索/身份引用（PMC-11 核实） | assistant 固定模板 + 白名单视图 `public.crm_search_people_v1`，refs 指向 `persons` 准确 ID；模型不生成 SQL、不按姓名自选 | businessDataWritten:false；Command→Plan→Preview→Confirm→Execute 授权链不变 |
| 前端 | Legacy=admin.html；新 AI-native=crm/console.html + js/modules/console/ | 新功能进模块化体系；不抽离 admin.html |

## 4. 已批准 / 未批准

- 已批准（持续授权）：PMC-00 文档建立与文档发布；常规 Git 提交/推送/标签；针对性部署受影响产物。
- 已批准（2026-10-07）：**PMC-02 数据模型与接口契约设计，D1–D11 全部按建议方案**（D5/D8 为路径批准，约束解除/列退出动作仍须届时单独授权）——见 [data-model.md](data-model.md) §8 与 decisions.md。
- 已批准（2026-10-08）：PMC-11 指令及编码前影响方案（AI 基础资料取 Person、业务域不动、缺失/冲突标注、非模型保存入口改造、历史快照不改写、不扩大自动写权限与 Quick Capture 灰度）；PMC-10 验收修复方案 A（persons anon 只读 GRANT/RLS）。
- 未批准：PMC-12～PMC-20 全部实施包（指令未收到）；PMC-11 验收本身（待用户确认）；G-PMC11-1 修复；一切删除/重命名已有对象（含 D5 姓名唯一约束解除、D8 customer_id 列/复合 FK 退出——须独立包单独批准）；`pr`/`pr_*` 相关一切；Legacy Quick Capture 流程变更；所有数据库变更（需 migration/rollback + 针对性确认）。

## 5. 已登记缺口（观察项，非阻塞；修复须另获授权）

> 2026-10-07 用户指示处置；处置结果见 evidence/PMC-00.md 第九节。

| # | 缺口 | 处置结果（2026-10-07） |
| --- | --- | --- |
| G1 | ~~外部迁移双备份滞后~~ | **已关闭（2026-10-07）**：用户授权后 `tools/sync-migration-backup.ps1` 执行成功——25 份旧稿/分叉稿非破坏性移入 `C:\Users\victor\cloudbase\migrations\_archive-20261007\`，本地 82 份全部镜像，脚本哈希自检 `[PASS] 82 files`；随后独立复核 local=82/external=82、mismatches=0 |
| G2 | `tcb -v` 触发意外交互式部署计划 | **已修复**：`tools/tcb.ps1` 增加显式子命令守卫（无命令/首参数为 flag 即拒绝）；已双向验证（`-v` 两种调用方式均拦截，`fn list` 正常） |
| G3 | cloudbase-mcp 未注册为 Trae 会话可调用工具 | **已修复**：新增 `tools/pg-readonly.cjs`——Trae/Codex 共用，经本机 cloudbase-mcp 执行单条 SELECT/WITH 只读查询；客户端拒绝 DDL/DML/多语句；已验证正常查询与三类拒绝路径。IDE 内 MCP 注册仍为可选项 |
| G4 | 称静态爬虫不覆盖 console.html 模块链 | **核实为过时记录，已更正**：`tests/wp01/static.cjs` 的 PAGES 早已含 `console.html`（WP2 加入）；50 个受检资产 = 2 HTML + 48 个 console 模块链 JS/CSS；两次 sync-check 实测全绿。无需改代码 |
| G-PMC11-1 | `ai_activity` analyze action 的 top3/no_followup 清洗只做 parseInt，未按真实参与者 ID 白名单过滤，模型编造 ID 会透传（participantReview/postReview 已有白名单） | **已登记未修（2026-10-09）**：既有缺陷、非 PMC-11 引入；隔离测试锁定现状。修复（同款白名单清洗）须单独授权。见 evidence/PMC-11.md §11 |
| G-PMC11-2 | 独立候选人（customer_id 为空）被 `v_recruit_candidates` 视图 INNER JOIN customers 过滤，recruit_recommend/recruit_score 对其返回「candidate not found」（git 证据：cbad9aa 已存在，非 PMC-11 回归） | **已登记未修（2026-10-09，验收中发现）**：修复涉视图 LEFT JOIN 或函数回退直查，属结构变更需 migration + 单独授权。见 evidence/PMC-11.md §11 |

## 6. 失败与未验证项

- PMC-11 无失败项：8 函数部署成功、隔离测试 19/19、真实模型 ai_referral 1 条 PASS；独立候选人缺陷为实施中发现并已修复（evidence §7）。
- PMC-11 未验证项（验收保留，详见 evidence/PMC-11.md §9）：① ai_recommendations listAll 双名搜索生产前端未实测；② recruit_recommend/score、ai_followup、policy_review_reports、ai_recommend 真实模型链路未调用（仅隔离验证）；③ ai_activity 全 action 无虚构测试活动、未真实模型验证；④ Console assistant 拒绝路径本轮未实测（静态白名单+GUIDANCE 确认）；⑤ postReviewV2 未真实调用；⑥ iPad AI 弹层人工回归待用户验收。
- PMC-00 范围内无失败项。G1–G4 缺口均已关闭。
- 其他历史未验证项：全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。
