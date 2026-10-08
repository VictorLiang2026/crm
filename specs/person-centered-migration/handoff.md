# Handoff（接管状态）

更新时间：2026-10-08（PMC-04 开包时）。任何工具接手前先读本文件与 execution-contract。

## 1. 执行状态

| 项 | 值 |
| --- | --- |
| 当前执行工具 | Trae（Kimi-K3 agent），2026-10-08 执行 PMC-05 |
| 最后完成包 | **PMC-04（人物身份及数据冲突确认）——已验收**：两轮只读冲突检测+脱敏清单+五分类确认；发布 `313e23c`/`release-20261008-115430`；2026-10-08 用户确认"都完成" |
| 正在执行包 | **PMC-05（兼容性的数据库结构扩展）——产物已落盘+Migration 已应用，待发布与用户验收**：customers.person_id bigint NULLABLE+UNIQUE+FK RESTRICT+部分索引；4 步 migration 已应用（40ms）；旧约束完整 5 个、视图 12 个正常、数据 783 行 person_id 全 NULL；不修改 RLS/视图/云函数 |
| 下一步唯一允许执行的动作 | 发布 PMC-05 产物（`tools/release.ps1` 含 migration SQL + 文档/工具）→ 三端核对 `sync-check.ps1` → 回填 evidence/PMC-05.md §7 → 停止等待用户验收 |
| 回滚条件 | 数据库回滚：执行 `cloudbase/rollbacks/20261008120000_customers_person_id.sql`（4 步：DROP CONSTRAINT FK+UNIQUE+INDEX+COLUMN）；当前 person_id 全 NULL 无消费者，回滚安全；代码回滚：git revert 本包提交即可（无云函数部署、无视图重建） |

## 2. 版本基线（2026-10-07 实测）

| 端 | 值 |
| --- | --- |
| 本地 | `master` @ `42787ff5dbc9202dd15882f6ffe12d09d2f8c44a`，工作树干净 |
| GitHub | `origin/master` @ `42787ff…`（fetch 后一致）；共 176 个标签 |
| 标签 | `release-20261007-193230`（PMC-01 发布）→ `42787ff…` |
| 云端 | admin.html SHA-256 一致；50 个静态资源一致；28 个函数 170 个文件一致；56 份共享副本一致（sync-check 全绿） |
| 数据库迁移 | 本地 `cloudbase/migrations/` 82 份 + `cloudbase/rollbacks/`；最新 `20261007000000_person_directory_customer_columns.sql`。外部双备份 82/82 哈希一致（旧稿 25 份归档于 `_archive-20261007/`，G1 已关闭） |
| 数据规模抽查 | `public.persons` 784 行（2026-10-07 PMC-01 核实；含 3 条软删除）；`customers` 783 行（含 1 条软删除）；780/784 persons 已映射 `legacy_customer_id` |

PMC-00 基线链：PMC-00 档案发布 `release-20261007-1153`/`-1209`（`4a700a1`）→ G2/G3/G4 处置 `release-20261007-125802`（`f9e7345`）→ G1 执行关闭 `release-20261007-135019` / 文档补录 `release-20261007-184445`（`3760891`）。各次发布三端 sync-check 均全绿，云端业务产物未改变。PMC-01 已开包，当前基线为 `3760891`，工作树 2 个文档修改待提交。

## 3. 各模块读写权威来源与兼容方向

| 模块 | 读/写权威来源 | 兼容方向 |
| --- | --- | --- |
| Person 基础身份 | `public.persons`；解析唯一走服务端 `PersonService.resolveName()` + 人工确认 | 不按姓名/手机号/AI 自动合并；Legacy 各表保留既有身份字段直至各包批准收敛 |
| 客户域 | `customers` 等客户表（callFn / customers 函数） | admin.html 单文件实现保留；软删除+同时间戳级联不动 |
| 互动 | `interactions`（RLS 仅 service_role；云函数经 person_360 委托） | Legacy followups 等旧来源继续可写；统一时间线只读映射 |
| 机会 | `opportunities`（Person 专属与旧 customer 机会隔离） | 旧 customer 机会与漏斗不动 |
| 行动/承诺 | `actions` / `commitments`（新写入走 Service+人工确认） | 旧来源经 `v_action_center` 可见，防重 |
| 招募 | `recruit_candidates` / `recruit_followups` | Legacy 完整保留；Person-only 招募待 WP13/PMC 相关包 |
| AI 审计 | `ai_tasks` / `ai_runs` / `ai_results`（service_role only） | 不照搬旧表匿名 CRUD |
| 前端 | Legacy=admin.html；新 AI-native=crm/console.html + js/modules/console/ | 新功能进模块化体系；不抽离 admin.html |

## 4. 已批准 / 未批准

- 已批准（持续授权）：PMC-00 文档建立与文档发布；常规 Git 提交/推送/标签；针对性部署受影响产物。
- 已批准（2026-10-07）：**PMC-02 数据模型与接口契约设计，D1–D11 全部按建议方案**（D5/D8 为路径批准，约束解除/列退出动作仍须届时单独授权）——见 [data-model.md](data-model.md) §8 与 decisions.md。
- 未批准：PMC-03～PMC-20 全部实施包（指令未收到）；一切删除/重命名已有对象（含 D5 姓名唯一约束解除、D8 customer_id 列/复合 FK 退出——须独立包单独批准）；`pr`/`pr_*` 相关一切；Legacy Quick Capture 流程变更；所有数据库变更（需 migration/rollback + 针对性确认）。

## 5. 已登记缺口（观察项，非阻塞；修复须另获授权）

> 2026-10-07 用户指示处置；处置结果见 evidence/PMC-00.md 第九节。

| # | 缺口 | 处置结果（2026-10-07） |
| --- | --- | --- |
| G1 | ~~外部迁移双备份滞后~~ | **已关闭（2026-10-07）**：用户授权后 `tools/sync-migration-backup.ps1` 执行成功——25 份旧稿/分叉稿非破坏性移入 `C:\Users\victor\cloudbase\migrations\_archive-20261007\`，本地 82 份全部镜像，脚本哈希自检 `[PASS] 82 files`；随后独立复核 local=82/external=82、mismatches=0 |
| G2 | `tcb -v` 触发意外交互式部署计划 | **已修复**：`tools/tcb.ps1` 增加显式子命令守卫（无命令/首参数为 flag 即拒绝）；已双向验证（`-v` 两种调用方式均拦截，`fn list` 正常） |
| G3 | cloudbase-mcp 未注册为 Trae 会话可调用工具 | **已修复**：新增 `tools/pg-readonly.cjs`——Trae/Codex 共用，经本机 cloudbase-mcp 执行单条 SELECT/WITH 只读查询；客户端拒绝 DDL/DML/多语句；已验证正常查询与三类拒绝路径。IDE 内 MCP 注册仍为可选项 |
| G4 | 称静态爬虫不覆盖 console.html 模块链 | **核实为过时记录，已更正**：`tests/wp01/static.cjs` 的 PAGES 早已含 `console.html`（WP2 加入）；50 个受检资产 = 2 HTML + 48 个 console 模块链 JS/CSS；两次 sync-check 实测全绿。无需改代码 |

## 6. 失败与未验证项

- PMC-00 范围内无失败项。G1–G4 缺口均已关闭（G1 于 2026-10-07 执行同步并独立复核 82/82 哈希一致）。
- 未验证（本包不要求）：业务回归、全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、真实登录与页面操作、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。
