# Handoff（接管状态）

更新时间：2026-10-07（PMC-00 完成时）。任何工具接手前先读本文件与 execution-contract。

## 1. 执行状态

| 项 | 值 |
| --- | --- |
| 当前执行工具 | Trae（GLM-5.3-Flash agent），2026-10-07 执行 PMC-00 |
| 最后完成包 | PMC-00（接管检查及执行档案建立；状态：已验收，证据见 evidence/PMC-00.md） |
| 正在执行包 | 无 |
| 下一步唯一允许执行的动作 | 等待用户下发 PMC-01 指令；收到后按 execution-contract A 开包。**未收到指令前不得实施任何业务变更** |
| 回滚条件 | 本包仅新增文档；如需回退，git revert 文档提交并删除远端标签对应提交引用即可（无云端产物、无数据库变更） |

## 2. 版本基线（2026-10-07 实测）

| 端 | 值 |
| --- | --- |
| 本地 | `master` @ `c5847b4be04a9560469bdf0e214d7a391b3820a2`，工作树干净（0 未提交文件） |
| GitHub | `origin/master` @ `c5847b4…`（fetch 后一致）；共 173 个标签 |
| 标签 | `20261007上午双语话`、`release-20261007-0200` 均指向 `c5847b4…` |
| 云端 | admin.html SHA-256 一致；50 个静态资源一致；28 个函数 170 个文件一致；56 份共享副本一致（sync-check 全绿，证据目录 `D:\Temp\crm-cloud-audit-6d69753698144bc69f3228d4226cb237`） |
| 数据库迁移 | 本地 `cloudbase/migrations/` 82 份 + `cloudbase/rollbacks/`；最新 `20261007000000_person_directory_customer_columns.sql`。外部双备份 `C:\Users\victor\cloudbase\migrations\` 仅 51 份、最新 2026-10-03（滞后，见缺口 G1） |
| 数据规模抽查 | `public.persons` 784 行（2026-10-07 只读 count；2026-10-02 规划基线 779，为正常业务增长） |

PMC-00 两次文档发布后基线前移至 `4a700a1`（标签 `release-20261007-1153`/`-1209`）；G1–G4 缺口处置发布后当前基线为 `f9e73455c1fb18750fc8e92edae9505431a0ac7c`（标签 `release-20261007-125802`），发布时三端 sync-check 全绿（28 函数 170 文件、50 静态资产、56 共享副本），云端业务产物未改变。开工 PMC-01 前仍必须按 execution-contract B 重新核对。

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
- 未批准：PMC-01～PMC-20 全部业务范围（指令未收到）；一切删除/重命名已有对象；`pr`/`pr_*` 相关一切；Legacy Quick Capture 流程变更；所有数据库变更（需 migration/rollback + 针对性确认）。

## 5. 已登记缺口（观察项，非阻塞；修复须另获授权）

> 2026-10-07 用户指示处置；处置结果见 evidence/PMC-00.md 第九节。

| # | 缺口 | 处置结果（2026-10-07） |
| --- | --- | --- |
| G1 | 外部迁移双备份滞后：`C:\Users\victor\cloudbase\migrations\` 与本地分叉（51 vs 82：43 缺失、13 同名旧草稿、12 本地已不存在的旧稿） | **待用户执行**：新增 `tools/sync-migration-backup.ps1`（先归档旧稿到 `_archive-20261007/` 再镜像、哈希校验，支持 `-DryRun`）。Trae 沙箱宿主拒绝向该外部目录写入（`dangerouslyDisableSandbox` 仍被拦），需用户在普通 PowerShell 运行一次：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-migration-backup.ps1`。用户运行并回报 `[PASS]` 后本项关闭 |
| G2 | `tcb -v` 触发意外交互式部署计划 | **已修复**：`tools/tcb.ps1` 增加显式子命令守卫（无命令/首参数为 flag 即拒绝）；已双向验证（`-v` 两种调用方式均拦截，`fn list` 正常） |
| G3 | cloudbase-mcp 未注册为 Trae 会话可调用工具 | **已修复**：新增 `tools/pg-readonly.cjs`——Trae/Codex 共用，经本机 cloudbase-mcp 执行单条 SELECT/WITH 只读查询；客户端拒绝 DDL/DML/多语句；已验证正常查询与三类拒绝路径。IDE 内 MCP 注册仍为可选项 |
| G4 | 称静态爬虫不覆盖 console.html 模块链 | **核实为过时记录，已更正**：`tests/wp01/static.cjs` 的 PAGES 早已含 `console.html`（WP2 加入）；50 个受检资产 = 2 HTML + 48 个 console 模块链 JS/CSS；两次 sync-check 实测全绿。无需改代码 |

## 6. 失败与未验证项

- PMC-00 范围内无失败项。
- 待办验证：G1 外部备份同步脚本需用户在沙箱外运行并回报 `[PASS]`（82/82 哈希一致）。
- 未验证（本包不要求）：业务回归、全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、真实登录与页面操作、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。
