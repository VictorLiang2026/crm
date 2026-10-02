# WP 13.6 · public 权限自动回归

本测试只读取 `public` 对象的目录元数据，不读取客户资料或测试记录，不改数据库。它把 2026-10-02 已核验的对象、策略表达式摘要和三种角色的**有效授权**固定在 `expected-public-baseline.json`；新增、消失或权限变化均使测试失败，必须人工复核后才可更新基线。基线不是对旧授权安全性的全面认可。

## 运行

1. 确认 CloudBase 环境为 `crm-d1gkae8ddc930d151`，使用 `queryPgDatabase(action="sql", limit=1)` 执行 `verify-public.sql` 全文。结果必须 `success=true`、`returnedRows=1`、`truncated=false`。
2. 将工具返回的 JSON 或其中 `data.rows[0].snapshot` 保存为 `tests/security/.results/live.json`，不要将凭据或业务行写进文件。此目录已被 Git 忽略。
3. 运行 `node tests/security/run.cjs --input tests/security/.results/live.json --output tests/security/.results/report.json`。退出码 0 为通过；非 0 为失败。`npm run test:security` 测试断言引擎的拒绝路径。

有本地匿名 publishable key 文件 `tests/permissions/.results/public-key.txt` 时，额外运行 `npm run test:security:gateway -- --output tests/security/.results/gateway.json`。它对 47 个 `public` 表/视图发送匿名只读请求：一般对象用 HEAD 的精确计数确认零可见行或拒绝访问；`v_funnel_stats` 天然有固定维度行，仅读取六个聚合数字列并确认均为零。不下载客户或 Person 行，不写数据库。没有 Key 时失败并明确报告未运行，不能算通过。

若有经过授权的 PostgreSQL 只读连接，可把连接串仅放在本地进程环境变量 `CRM_SECURITY_PG_URL`，运行 `node tests/security/run.cjs --psql --output tests/security/.results/report.json`。脚本通过 `psql` 执行同一份只读 SQL，不打印或保存连接串。CloudBase CLI 3.8.1 当前没有直接查询 PG 的命令，因此项目默认用 CloudBase 只读查询导出结果。

目录检查包括：表 RLS 与策略、所有视图的 `security_invoker`、`anon`/`authenticated`/`service_role` 的有效关系授权、序列授权、数据库函数执行授权及 `SECURITY DEFINER` 漂移。它会拒绝截断结果、缺失对象和未经审阅的新对象。匿名网关探针补充验证当前公开 Key 的实际读路径；仍不能证明真实登录用户路径、服务端身份或 RPC 网关是否执行函数授权。这些路径应按 `tests/permissions/README.md` 用隔离账号/记录验证。

旧业务表对 `anon` 的授权、旧序列对 `authenticated` 的授权，以及部分触发器函数对 `anon` 的执行授权被记录为现状；不能由此推断匿名客户端可读取客户行。未经单独评估和兼容回归，不直接收紧旧授权。
