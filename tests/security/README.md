# WP 13.6 · public 权限自动回归

本测试只读取 `public` 对象的目录元数据，不读取客户资料或测试记录，不改数据库。它把 2026-10-02 已核验的对象、策略表达式摘要和三种角色的**有效授权**固定在 `expected-public-baseline.json`；新增、消失或权限变化均使测试失败，必须人工复核后才可更新基线。基线不是对旧授权安全性的全面认可。

2026-10-16 PC14 更新：仅在完整核对 `public.crm_ocr_parse_commands` 的 FORCE RLS/service_role-only 策略，以及三条 OCR 审阅 RPC 仅授予 `service_role` 后，将这 4 个新对象加入预期快照；不刷新或接受其他对象漂移。

2026-10-16 PC15 更新：已核对 `public.crm_opportunity_directory_v1` 的签名和有效执行权限，确认仅 `service_role` 可执行，`anon` 与 `authenticated` 不可执行；仅将该函数加入预期快照。

2026-10-17 PC27 更新：核对 `public.assistant_opportunity_commands` 的 FORCE RLS、service_role-only 策略/表权限，以及 `public.assistant_opportunity_command_v1` 仅授予 `service_role` 执行；仅加入这两个新对象，未接受其他目录漂移。

2026-10-18 PC28 更新：核对 `public.assistant_recruit_delete_commands` 的 FORCE RLS、service_role-only 策略与表权限，以及 `public.assistant_recruit_delete_command_v1` 仅授予 `service_role` 执行；仅加入这两个对象。发布前对完整线上目录快照比较，未接受其他对象漂移。

## 运行

1. 确认 CloudBase 环境为 `crm-d1gkae8ddc930d151`，使用 `queryPgDatabase(action="sql", limit=1)` 执行 `verify-public.sql` 全文。结果必须 `success=true`、`returnedRows=1`、`truncated=false`。
2. 将工具返回的 JSON 或其中 `data.rows[0].snapshot` 保存为 `tests/security/.results/live.json`，不要将凭据或业务行写进文件。此目录已被 Git 忽略。
3. 运行 `node tests/security/run.cjs --input tests/security/.results/live.json --output tests/security/.results/report.json`。退出码 0 为通过；非 0 为失败。`npm run test:security` 测试断言引擎的拒绝路径。

有本地匿名 publishable key 文件 `tests/permissions/.results/public-key.txt` 时，额外运行 `npm run test:security:gateway -- --output tests/security/.results/gateway.json`。它对 47 个 `public` 表/视图发送匿名只读请求：一般对象用 HEAD 的精确计数确认零可见行或拒绝访问；`v_funnel_stats` 天然有固定维度行，仅读取六个聚合数字列并确认均为零。不下载客户或 Person 行，不写数据库。没有 Key 时失败并明确报告未运行，不能算通过。

若有经过授权的 PostgreSQL 只读连接，可把连接串仅放在本地进程环境变量 `CRM_SECURITY_PG_URL`，运行 `node tests/security/run.cjs --psql --output tests/security/.results/report.json`。脚本通过 `psql` 执行同一份只读 SQL，不打印或保存连接串。CloudBase CLI 3.8.1 当前没有直接查询 PG 的命令，因此项目默认用 CloudBase 只读查询导出结果。

目录检查包括：表 RLS 与策略、所有视图的 `security_invoker`、`anon`/`authenticated`/`service_role` 的有效关系授权、序列授权、数据库函数执行授权及 `SECURITY DEFINER` 漂移。它会拒绝截断结果、缺失对象和未经审阅的新对象。匿名网关探针补充验证当前公开 Key 的实际读路径；仍不能证明真实登录用户路径、服务端身份或 RPC 网关是否执行函数授权。这些路径应按 `tests/permissions/README.md` 用隔离账号/记录验证。

旧业务表对 `anon` 的授权、旧序列对 `authenticated` 的授权，以及部分触发器函数对 `anon` 的执行授权被记录为现状；不能由此推断匿名客户端可读取客户行。未经单独评估和兼容回归，不直接收紧旧授权。


2026-10-16 PC19 更新：已核对两个 public.crm_recruit_candidate_*_v1 RPC 的签名及有效执行权限，均为 SECURITY DEFINER 且仅 service_role 可执行；anon 与 authenticated 均无执行权。仅将这两个精确签名加入预期快照。

2026-10-17 PC24 更新：已核对 `public.crm_search_people_v2(jsonb,integer,integer)` 为 SECURITY INVOKER，只授予 `service_role` 执行；`anon` 与 `authenticated` 均不可执行。只将该固定只读 RPC 签名加入预期快照。

2026-10-19 PM18 兼容例外：`routine:pmc18_collect_once_v1()` 暂保留 anon-only ACL。实测撤销 anon 并授予 service_role 会使现有 `pmc18_observer` 的 `app.rdb()` 调用失败；恢复 anon 后返回当日已采集快照。例外仅接受 `anon=true`、`authenticated=false`、`service_role=false`、`SECURITY DEFINER=true` 的该精确签名，理由和预期 ACL 见 `routine-execution-exceptions.json`。其他例程仍必须有 service_role 执行权限。PM18 若改为 service_role 通道，需单独审批、部署并回归后移除此例外。

2026-10-19 PM18 匿名网关探针例外：用户批准对 `public.pmc18_observations` 做单表、精确探针。探针只发送 HEAD 并记录 HTTP 状态与 Content-Range 的总行数，不发送 GET、不读取或保存行内容；只接受 HTTP 206 且总行数为正的 20 的倍数（采集器每个完整快照包含 20 项聚合指标）。此例外不授予新权限，也不改变现有 ACL / `pmc18_observer` 行为。若指标数、响应状态或计数格式异常，检查失败关闭。

2026-10-27 Knowledge OCR：用户批准新增 `public.crm_knowledge_ocr_input_v1(bigint,uuid)`。例外只允许 `anon_execute=true`、`authenticated_execute=false`、`service_execute=false`、`security_definer=true`。函数须同时验证来源 ID、随机上传令牌、`extracting` 状态、图片 MIME 类型及 6 MiB / Base64 长度限制，只返回图片原件给既有 `ai_parse` OCR 调用；不授予 `knowledge_sources` 表级读取权限。替换为服务端身份验证调用后，应撤销 anon execute 并移除此例外。
