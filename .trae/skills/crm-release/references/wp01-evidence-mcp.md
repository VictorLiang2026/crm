# WP01 门证据过期重采（CloudBase MCP stdio 桥）

`tests/wp01/run.cjs` 的 catalog 与 wp04 身份证据有效期 **1 小时**。IDE 无 MCP 集成时，用 node spawn 官方 CLI 的 stdio JSON-RPC 桥采集，无需交互窗口。桥脚本放系统 Temp，**用后即删（响应含 STS 凭证时尤其如此）**。

## 1. 定位 MCP CLI

`%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@cloudbase\cloudbase-mcp\dist\cli.cjs`（备用：`%APPDATA%\npm-cache\_npx`）。多个副本取 mtime 最新者。

## 2. JSON-RPC 骨架（stdio）

依次写入（换行分隔）：

1. `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"crm-collect","version":"1.0"}}}`
2. `{"jsonrpc":"2.0","method":"notifications/initialized"}`
3. 延迟 ~800ms 后写 `tools/call`（id=2），name=`queryPgDatabase`，arguments：
   - catalog：`{"action":"sql","sql":"<tests/wp01/catalog.sql 全文>","limit":1}`
   - wp04：同上，sql 换成 `tests/wp04/audit.sql` 全文

在 stdout 逐行收集，按 id===2 取响应后立即 kill 子进程（超时建议 120s）。

## 3. 响应解包（顺序严格，参照 tests/security/run.cjs 的 unwrap）

1. `result.content` 中 `type==='text'` 的 text 拼接；**文本前面可能有 BOM 和"正在执行 SQL…"进度行**：从每个 `{` 起逐段尝试 `JSON.parse`，取第一个成功的，不要假设开头即 JSON。
2. `success===false` → 失败（看 errorCode）。
3. 必须 `data.truncated` 为假、`data.returnedRows===1`、`data.rows.length===1`，否则是不完整快照，不得落盘。
4. 取 `data.rows[0]`；若有 `snapshot` 字段取 snapshot（可能是字符串，需再 parse 一次）。
5. 形状校验：catalog 需 `schema==='public'` 且 `objects` 为数组（约 130+ 对象，含 roles/observedAt）；audit 需 `summary` 为 4 项数组（customers/participants/recruits/speakers）。

落盘：
- `tests/security/.results/wp01-catalog.json`（解包后的 snapshot JSON）
- `tests/security/.results/wp04-audit.json`（同上；用 `tests/wp04/audit.cjs` 的 evaluate 配合 `tests/wp04/exceptions.json` 复核，期望 PASS 或 PASS_WITH_EXCEPTIONS、failures 为空）

原始文本可同时留一份 `*-raw.json` 便于追溯。采集后立即跑 `node tests/wp01/run.cjs` 刷新报告。

## 4. 认证

- 先调 `auth` 工具：`{"action":"get_temp_credentials","reveal":true,"confirm":"yes"}`。成功返回嵌套结构 `data.credentials.{secretId,secretKey,token}`（env_id 应为 `crm-d1gkae8ddc930d151`）。
- 返回 `AUTH_REQUIRED` 时走设备码：`start_auth` → **必须在同一进程内长驻轮询** `poll status`（进程退出则授权结果无人认领，需用户重新扫码/确认）。完成判定：`ok === true && auth_status !== 'PENDING' && auth_status !== 'REQUIRED'` 才 break；随后再 `get_temp_credentials`。
- PS 5.1 直接 `ConvertFrom-Json` 该凭证可能报错；用 node 生成 `$secretId='...'` 变量文件（单引号翻倍转义）供 PowerShell dot-source。
- 只读 SQL 查询与取凭证可在沙箱内完成（MCP 自带鉴权）；tcb 部署命令才需要 `dangerouslyDisableSandbox`。

## 5. MCP applyMigration 规则（门修复需要执行迁移时）

工具名 `managePgDatabase`，action `applyMigration`：

- `migrationName` 正则 `^[a-z][a-z_]*$`——**全小写字母/下划线，禁止数字**（如 `pmc_restore_view_security_invoker`，不能用 `pmc20_...`）。
- `migrationVersion` 为 14 位时间戳（如 `20261010223000`）。
- 本地须存在 `cloudbase/migrations/<version>_<name>.sql`；迁移与 rollback 成对提交（`<同名>.rollback.sql`）。
- 仅操作 `public` schema；执行后用 queryPgDatabase 复查实际效果（如 `pg_class.reloptions` 中 `security_invoker=true`），不能只信 TaskId 返回。
- `CREATE OR REPLACE VIEW` 会重置 reloptions——重建视图后必须显式 `ALTER VIEW ... SET (security_invoker = true)` 恢复，不能假设重建保留该设置。

## 6. 门指纹与顺序

- 门指纹覆盖：`admin.html`、`package.json`、`cloudbaserc.json` 以及 `crm/`、`cloudfunctions/`、`cloudbase/`、`tools/`、`tests/` 下全部被跟踪或未忽略文件。门报告生成后再改其中任何文件，`--assert-release` 即报 "Source/test/tool files changed after checks"。
- 推荐顺序：修完所有门测试/基线问题 → 采集 catalog+audit 两份证据 → 跑一次完整门确认 blockers 为空 → 1 小时内完成部署与 release.ps1。门阻塞是链式暴露的，不要在证据过期后才从头修。
