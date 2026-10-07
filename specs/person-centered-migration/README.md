# Person 中心化迁移（PMC 系列）

状态：PMC-00 已完成接管检查与档案建立（2026-10-07）。本目录是 Person 中心化迁移的**唯一权威档案**；PMC-00～PMC-20 编号独立于已有 WP 工作包体系，避免混淆。

## 目标

把 CRM 的身份与基础信息权威来源收敛到 Person，同时保留 Legacy 功能、`callFn` 数据入口、登录/RLS/软删除语义。迁移按 PMC-00～PMC-20 逐包执行，一次只执行用户指定的一个包；每包完成发布并验收后才进入下一包。

各包的详细指令由用户逐包下发；**未收到的指令不得自行猜写为已确认方案**。

## 文档索引与阅读顺序

任何执行工具（Trae / Codex）接手任一 PMC 包时，按以下顺序阅读：

| 顺序 | 文件 | 用途 |
| --- | --- | --- |
| 1 | `AGENTS.md`（根目录） | 17 条不可违反的工作规则、环境范围、修改前/验证/发布约定 |
| 2 | `docs/development-environment.md` | 环境配置、发布流程、基线命令 |
| 3 | `docs/开发安全边界说明.md` | 架构/数据库/云函数/前端红线、危险修改点速查 |
| 4 | [execution-contract.md](execution-contract.md) | **PMC 系列所有工作包必须遵守的执行约定（A–N）** |
| 5 | [requirements.md](requirements.md) | 迁移业务目标、边界和验收标准 |
| 6 | [design.md](design.md) | 逐包完善的设计、当前权威数据源 |
| 7 | [tasks.md](tasks.md) | PMC-00～20 状态、依赖、证据链接 |
| 8 | [handoff.md](handoff.md) | 当前状态、基线版本、下一步唯一允许动作 |
| 9 | [decisions.md](decisions.md) | 决策及用户批准记录（按需） |
| 10 | [impact-matrix.md](impact-matrix.md) | 字段、函数/action、调用方和工作包映射（按需） |
| 11 | `evidence/PMC-XX.md` | 当前包及前置包的执行、测试、发布、恢复记录 |

与既有文档的关系：`specs/target-crm-v1/` 是目标 CRM 总体规划（WP 体系），本目录是其中"Person 中心化"主线的执行档案。两者冲突时，以用户对当前包的明确指令 + 本目录 `decisions.md` 的批准记录为准；历史验收记录保留原日期，只追加"已被后续方案取代"标记和链接，不直接改写历史事实。

## 当前状态速览

- 基线提交：`c5847b4be04a9560469bdf0e214d7a391b3820a2`（标签 `release-20261007-0200`、`20261007上午双语话`），本地 / GitHub / 云端一致。
- 最后完成包：PMC-00（接管检查及执行档案建立）。
- 正在执行包：无——等待 PMC-01 指令。
- 已登记缺口：见 [handoff.md](handoff.md) 第 5 节（外部迁移备份滞后等）。
