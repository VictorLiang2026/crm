# PC12 发布与回归记录

## 范围与基线

- 基线：`master` / `27a05b76e29537a48340ec7a437e1b12fb737632` / `release-20261015-223200`。
- CloudBase 环境：`crm-d1gkae8ddc930d151`；仅操作 `public`。
- 用户确认：为 products 增加版本与 customer_id 唯一约束；Person→客户由服务端解析并 CAS；保留 Legacy；允许仅对测试客户 #788 的 products #2 临时替换和精确恢复；金额沿用旧值，按人民币元展示且不换算。
- 首次完整 sync-check 通过；GitHub、线上页面、29 个函数的 182 个源码/配置文件及静态模块与基线核对一致。

## 变更

- 数据库迁移 `20261015203000_products_insurance_version`：检查 NULL/重复客户关联后，仅为 `public.products` 增加 `version` 和 `UNIQUE(customer_id)`。同目录提供 rollback；回滚只删除新增约束和列，不碰保险数据。
- `products` 云函数保留 Legacy `customer_id` list/upsert/remove 契约，新增由服务端解析 Person 客户映射的入口、精确字符串字段校验及版本 CAS。
- Person 360 增加 11 类 × 5 字段保险编辑，未知与 0 分开保存，保留 iPad 横竖屏布局、中英 i18n、旧值和 AI 建议来源语义。
- `person_360` 上下文及 `policy_review_reports` 查询读取 bigint 字符串。`products_view` 保持原列投影；新版本字段只用于写冲突控制，无需扩展旧视图契约。

## 部署

- 数据库：迁移历史已记录到 `20261015203000`；任务 `task-ed2f6b5afade418f` 状态 Succeed，`public.products` schema/索引及行版本已复核。
- 云函数：仅部署 `products`、`person_360`、`policy_review_reports`，全部返回成功。
- 静态托管：仅上传 `data.js`、`i18n.js`、`pages/person.js`、`insurance-editor.js`、`console.css` 五个变更文件，全部成功。线上 Console 地址：<https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html>。
- 发布标签：`release-20261016-002000`（提交及推送结果由发布脚本校验）。

## 验证

- `npm run test:pc12`：9/9 通过；iPad 1024×768、768×1024 均无横向溢出，11×5 输入、bigint 字符串、未知/零值、并发冲突与无客户关联路径通过。
- `tests/households/insurance-context.cjs`、`tests/wp11/report-marker.cjs`、`tests/pc04/person-customer-operations.test.cjs`：11/11 通过；另 `npm run test:pc04` 8/8、`npm run test:modular` 通过。
- `npm run test:browser`：隔离浏览器 72 PASS、0 FAIL、6 SKIP。初次运行时 Windows 临时目录落在已满的 D 盘导致调试器超时；设置本进程 `TEMP/TMP=C:\Temp` 后通过。
- WP01：安全目录 881 项通过（52 表、12 视图、37 序列、45 routine）；匿名探针 64/64；WP02/WP03/WP04/WP05/WP06 夹具及完整隔离回归通过；`npm run check:release-gate` 通过。
- 真实 `products` 云函数：Person 783 服务端解析到客户 788；首次创建衍生 products #3（version 1）；读取保留 bigint 上限字符串 `9223372036854775807`、保费 `9007199254740993.50`、年限 `10.5`、空值与明确 0；更新到 version 2；负数与 bigint 溢出被拒；并发相同版本只允许一方写入到 version 3，另一方及旧版本重放返回 `VERSION_CONFLICT`；Legacy `customer_id=788` 查询可读到同一行。`policy_review_reports.list(customer_id=788)` 实际调用成功，返回 1 条。
- 恢复：先删除衍生产品 #3，再从 C 盘隔离快照恢复产品 #2。恢复前后快照 SHA-256 为 `4EB16C0AC9735AB3D15CBCBFDCCE7DD513583FEBE5C0167C2B254DF748366B1C`；18 个原业务列值逐项一致，恢复后 version=1；Person 函数再次读取到 products #2 / version 1 / `ap_ci="200000"`。测试台账未改，初始种子仍为 10 行。
- MCP migration apply 因其固定 D 盘工作区空间为 0 而未提交；改用 C 盘隔离目录从线上 fetch 完整 79 条已应用迁移，预览仅含本包迁移且无冲突后，通过 CloudBase CLI 应用。迁移任务成功并在远端历史及线上 schema 复核。
- 发布后 CloudOnly 完整 sync-check：57 个页面可达静态资产一致；29 个函数的 183 个源码/配置文件一致；云端审计目录 `C:\Temp\crm-cloud-audit-6d49dce319d142028e43afe1bec899f3`。

## 未验证项与回退

- WP01 门禁保留人工 Console 登录、service_role 运行时、真实移动设备检查为未验证项；匿名只读、离线回归和合成产品云函数写入已各自单独验证。
- `person_360` 的线上认证入口无法由无登录 CLI 代替，保险上下文通过离线服务回归验证；本轮没有触发 AI 报告生成或任何外部动作。
- 页面/函数回退到前一发布标签并仅重部署上述受影响产物。数据库 rollback 前须复查 products 版本消费者和唯一 customer 行状态；回滚不删除保额数据。
