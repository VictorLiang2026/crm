# 开发环境与发布流程

确认日期：2026-09-20。长期规则见根目录 `AGENTS.md`。

| 项目 | 配置 |
| --- | --- |
| 本地 | `D:\CRM\crm` |
| GitHub | https://github.com/VictorLiang2026/crm |
| 发布分支 | `master` |
| CloudBase | `crm-d1gkae8ddc930d151`，个人版，状态 NORMAL |
| 地域 | 项目规格记录为 `ap-shanghai` |
| 线上页面 | https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html |
| 静态托管路径 | `/crm/admin.html` |
| 前端 | `admin.html`，原生单文件，无 npm dev/build 流程 |
| 后端 | `cloudfunctions/`，26 个 CRM 云函数，PostgreSQL `app.rdb()` |
| 运行时 | 线上混用 Nodejs18.15 / Nodejs20.19；不随本机 Node 版本自动升级 |
| 本机工具 | Node 26.8.2 / npm 11.19.1 / Git 2.55.0 / CloudBase CLI 3.8.1 |

CLI 不在当前 PATH 时使用 `tools/tcb.ps1`，自动定位现有安装，不修改系统 PATH、不安装软件。
PowerShell 示例：`& .\tools\tcb.ps1 -CliArgs @('fn','list','-e','crm-d1gkae8ddc930d151','--json')`。用参数数组传递，避免 `-e` 被 PowerShell 当作公共参数缩写。
`cloudbaserc.json` 是从线上读取的完整 26 函数非敏感配置；环境变量和凭据仍在云端，不入库。
同环境还有 26 个 `pr_*` 函数；另一体验版环境 `crm-victor-d4g3a9vr011807bdb` 用途未确认，不能默认作为测试环境。

**迭代隔离边界（用户确认）**：当前系统的数据查询、写入、迁移、数据库对象/权限调整和测试操作均仅限 `public` schema；SQL 明确限定 `public`。不涉及 `pr` schema，也不调用、修改、部署或删除任何 `pr_` 前缀云函数。禁止跨 schema 引用或级联操作间接影响 `pr`；发现依赖时停止并报告。

## 接手基线

初始提交 `bcea0ce82458780773cfd0da794adfc72a4e77df`，标签 `release-20260916-1434`。
2026-09-20 已实时验证 GitHub master 与本地相同、页面 HTTP 200 且 SHA-256 相同、26 个云函数 108 个源码/配置文件逐一相同。80 个 JS 文件语法通过。
这不等于业务回归、数据库迁移核对或已安装依赖逐项比对；这些需在相关迭代中单独验证。

## 每轮发布

1. 改动前运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/sync-check.ps1`；默认包括云函数源码核对。确认影响范围及必要的用户确认。
2. 开发、语法检查、针对性回归；更新本轮发布记录（变更、影响、测试、回滚、未验证项）。
3. 部署变更产物。云函数源码更新使用 `tools/deploy-function.ps1 -Function <清单中的函数名>`，入口会先从 `cloudfunctions/_shared` 同步 `db.js` / `ai.js`，核验 52 份副本的 SHA-256，再仅上传指定函数；失败即停止。其他部署方式也必须先运行 `npm run build:shared` 与 `npm run check:shared`。旧页面只上传 `admin.html` 到 `/crm/admin.html`；新 AI-native 前端静态文件按实际变更逐个上传到 `/crm/js/`、`/crm/css/`，不上传整个项目目录。
4. 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "变更说明" -Tag "release-YYYYMMDD-HHmmss"`。脚本先核对云端，再提交/推送/打标签；遇错中止。脚本本身不部署云资源。
5. 发布后运行完整 `sync-check.ps1` 并验证线上受影响业务。失败则继续处理，不得把提交成功等同发布完成。

`sync-check.ps1 -CloudOnly` 用于部署后、提交前核对云端；不表示 GitHub 一致。
本机 Windows PowerShell 默认禁止脚本执行；上述 Bypass 仅作用于本次已审阅脚本进程，不修改系统或用户执行策略。
云函数下载到系统临时目录，保留为本轮比对证据，不进入项目或 Git。
恢复旧代码需基于已记录标签，重新部署受影响产物并创建恢复提交；不使用强制推送。数据库迁移需单独制定兼容/恢复方案。

## Codex MCP

项目级 `.codex/config.toml` 配置 CloudBase MCP，不包含凭据。重启/重新加载 Codex 后确认工具是否出现；当前任务仍可通过已验证的 CLI 工作。
官方配置说明：https://developers.openai.com/zh-Hans/docs/extend/mcp 。项目配置仅在受信任项目生效。

## 功能回归记录要求

- 记录修改功能的实际输入、预期和结果，必要时使用专用测试记录并清理。
- 公共逻辑改动覆盖登录/会话、客户列表和详情、跟进、活动、增员、回收站恢复。
- 未修改业务产物的文档/工具发布，以线上源码一致性作为业务未改变的证据，注明没有重新执行业务操作测试。
