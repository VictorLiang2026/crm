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

PMC-00 文档发布后，以上 Git 基线将前移一个文档提交（无云端产物变化）；开工 PMC-01 前必须按 execution-contract B 重新核对。

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

| # | 缺口 | 影响 | 建议 |
| --- | --- | --- | --- |
| G1 | 外部迁移双备份滞后：`C:\Users\victor\cloudbase\migrations\` 51 份（最新 2026-10-03）vs 本地 82 份（最新 2026-10-07），约 31 份未同步 | 若本地盘故障，10-03 后的迁移无外部备份 | 下一个涉及数据库的包开工前先补齐双备份（纯复制操作，可届时请示） |
| G2 | `tcb -v` 触发意外交互式部署计划（28 函数覆盖更新确认），停于 Y/n 未执行；事后 sync-check 证明零变化 | 误操作风险 | 只用显式命令（`fn list` 等）；禁用模糊参数；交互式提示出现立即停止 |
| G3 | cloudbase-mcp 未注册为 Trae 会话可调用工具 | Trae 内不能直接调 queryPgDatabase | 已验证替代路径：Node 直启 `C:/Users/victor/AppData/Local/npm-cache/_npx/88d9f76c32260533/node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs`（stdio MCP，2.34.8） |
| G4 | `tests/wp01/static.cjs` 一致性爬虫只从 admin.html 出发，console.html 模块链不在 sync-check 覆盖内 | console 文件漏部署不会被拦截（WP1 白屏事故根因） | console 相关部署人工核对 git 清单；待后续工作包把 console.html 加入遍历入口 |

## 6. 失败与未验证项

- PMC-00 范围内无失败项。
- 未验证（本包不要求）：业务回归、全量数据库结构盘点（沿用 2026-10-02 盘点基线）、`pr` schema 现状（禁入，不盘点）、真实登录与页面操作、`pr_*` 函数清单全量核对（仅确认存在）。

## 7. 状态口径

未开始 / 执行中 / 待确认 / 阻塞 / 待验证 / 观察中 / 已验收——定义见 execution-contract N。开发完成只标"待验证/观察中"，验收以用户确认为准。
