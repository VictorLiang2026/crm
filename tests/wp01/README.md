# WP01 一键安全检查

工作目录为仓库根目录，运行 `npm run test:wp01`。它重跑权限断言、门槛失败路径、SDK 固定/事务兼容测试、完整隔离浏览器 regression 和匿名网关探针，读取本轮人工登录摘要，生成：

- `tests/security/.results/wp01-report.json` 与同名 Markdown：发布判定及逐条旧路由 smoke。
- `tests/security/.results/wp01-anonymous.json`：匿名逐对象结果。
- `tests/regression/.results/latest.json`：94 项隔离回归与 5 项历史预设跳过。预设跳过不覆盖 WP01 单独取得的登录/权限结果。

四种状态分别为“自动通过 / 失败 / 需人工登录 / 未验证”。退出码 0 表示基础发布门槛通过且仍可能有明示缺口，1 表示失败，2 表示关键证据缺失或不可访问。绝不把哈希一致、空表或缺凭据当作真实业务通过。

## 首次准备与过期重采集

数据库访问使用已有授权。当前 CLI 不提供项目已验证的只读 SQL 查询入口，因此不伪造无人值守采集：

1. 确认 CloudBase MCP `queryPgDatabase(action="context")` 的 envId 为 `crm-d1gkae8ddc930d151`。
2. 执行本目录 `catalog.sql` 全文，`action="sql", limit=1`。确认 success=true、returnedRows=1、truncated=false，把完整工具 JSON 或 snapshot 原样保存到 `tests/security/.results/wp01-catalog.json`。SQL 返回数据库采集时间，不能用改文件时间来延长有效期。
3. 匿名探针使用既有 `tests/permissions/.results/public-key.txt`；也可由 `CRM_PUBLIC_KEY_FILE` 指向受保护本地文件。不要提交 Key。
4. 一键运行 `npm run test:wp01`。数据库证据和发布报告有效期均为一小时；缺失或过期会阻断发布并提示重采集。

WP04 起，运行第 4 步前还须通过同一只读入口执行 `../wp04/audit.sql`，验证完整结果后将解析的 snapshot 保存至 `tests/security/.results/wp04-audit.json`。身份覆盖证据也只有效一小时；已列明的待确认身份与新增遗漏/冲突分别处理，详见 [WP04 复跑说明](../wp04/README.md)。下方 `--psql` 只刷新权限目录，不自动刷新身份快照。

有已获授权的只读 PG 连接及 psql 时，将连接串放在当前进程的 `CRM_SECURITY_PG_URL` 环境变量，可用 `npm run test:wp01 -- --psql` 自动刷新目录后执行整套检查。连接串不放在命令行、仓库或报告里，查询强制只读事务。此次未验证此可选连接方式。

真实登录单独运行 `npm run test:wp01:login`，在独立窗口输入测试账号。它提取当前 admin.html 的登录实现并使用同一固定 SDK；有效 getSession 后只以 HEAD 请求检查 public 的 47 个对象，并通过 customers.list 查询唯一虚构关键词。页面不加载业务路由，不发起 AI 或写入。报告仅保留预定义检查 ID、状态、时间与页面哈希；不保存凭据/身份/客户内容。结束后退出此测试会话。没有人工参与或证据过期时，主报告显示“需人工登录”。此手动步骤无法由自动化代替。

## 发布拦截

`npm run check:release-gate` 只核验刚生成的结果，重新校验原始目录快照，核对源码/测试/工具/迁移指纹和登录摘要。权限漂移、任何实际 FAIL、关键检查未验证、报告缺失/过期、测试后文件变化均阻断。

- `tools/release.ps1` 在 fetch/commit/tag/push 前调用此门槛。
- `tools/deploy-function.ps1` 在共享文件同步之后、上传之前调用门槛；若同步改变文件，先停止，重新回归。
- 页面/模块通过管理工具上传前也必须执行门槛；脚本不能拦截绕过仓库工具的控制台操作。
- `tools/sync-check.ps1` 继续做三端源码核对，并新增当前页面可达的 JS/CSS 一致性检查。变更页面在部署前用安全门槛、部署后用源码核对，不能要求尚未部署的新源码先与线上相同。

本基础门槛不冒充 WP26 的完整线上权限 CI。服务角色运行时、线上写入/删除/恢复、真实 AI 和移动端缺口继续保留；涉及这些路径的后续 WP 必须补相应授权和实际回归。任何已经执行且失败的登录测试仍会阻断，不能自动降级成可忽略项。

## 范围与恢复

catalog.sql 只读取 public 对象的目录信息，以及 anon/authenticated/service_role 的角色属性；不是 migration。不会创建业务样本、迁移或修改权限。既有权限基线与新增角色属性基线不能自动更新；漂移必须先停下核实。

本轮工具可通过新的恢复提交恢复到 `release-20261002-231216`；新增测试/文档的回退不影响云端业务或数据库。不删除/重命名任何已有业务对象或路由，不强推。
