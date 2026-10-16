# PC14：OCR 与资料解析审阅及安全撤销

## 范围

- 在 Person 资料页查看已关联客户的 OCR 记录、原文件、识别摘要与原文。
- 继续调用现有 `ai_parse` 生成资料候选；不修改现有 `ai_parse`、`ocr_records`、`photos` 或 Quick Capture 流程。
- 逐字段编辑与勾选候选值；Person 姓名只用于身份核对，不作为可写字段。
- 服务端再次调用 `PersonService.resolveName()` 核实候选，核对当前 Person/客户/OCR 关系，生成只读预览；人工确认后，原子写入所选字段。
- 应用和撤销均使用 actor-bound 幂等命令；撤销限于本次解析涉及的字段。字段值变化或目标行版本变化时，服务端拒绝撤销并提示重新核对。
- 仅用虚构浏览器样本回归；不读取或修改真实客户 OCR 内容。

## 数据与兼容性

- 仅限 `public` schema。新增 service_role-only 审计表 `crm_ocr_parse_commands` 与三个 RPC：`crm_ocr_parse_preview_v1`、`crm_ocr_parse_undo_preview_v1`、`crm_ocr_parse_execute_v1`。
- Migration `20261016110000_ocr_parse_review` 建立审计和字段级预览执行；`20261016111500_ocr_parse_row_versions` 补上行版本检查，能识别字段值被改动后又改回的情形。两项均有配套 rollback；审计记录存在时 rollback 会拒绝删除。
- 审计表不为现有 Person、customer 或 OCR 表添加外键，避免改变旧记录删除/回收站语义。
- 不写 `customer_name`、`recruitment_priority` 或其他会触发关联身份创建/机会副作用的字段；AI 解析本身不写业务数据。
- 更新 public-only 安全基线，仅接受本次核实过的 1 张 service_role-only 表及 3 条 service_role-only RPC。

## 验证

- `npm run test:pc14`：服务端边界、迁移合同、legacy 路由保持、身份选择、字段预览、人工执行、原文件展示、成功撤销与版本冲突拒绝、双语/iPad 布局。
- `npm run test:pc11`、`npm run test:pc12`、`npm run test:pc13`、`npm run test:modular`、`npm run check:shared`、`npm run test:security`。
- 生产迁移任务：`20261016110000` 与 `20261016111500`，均已由 CloudBase PG migration 应用并核验成功。
- 生产 `public.crm_ocr_parse_commands` 初始行数为 0；没有创建测试 Person/customer/OCR 行。
- 生产 schema 查询确认字段及权限；WP01/WP04 只读证据于 2026-10-16 11:01（Asia/Shanghai）采集，随后安全基线已作 PC14 限定更新。
- 新增 `person_360` 云函数代码已部署；MCP 上传 5 个静态文件成功。`sync-check.ps1 -CloudOnly` 确认 29 个 CRM 云函数共 184 个源码/配置文件、59 个页面可达模块/样式文件一致。
- 已尝试以 CLI 只读调用 `person_360.listOcrParseCommands`；函数执行到现有认证门后返回 `UNAUTHORIZED`，因为 CLI 调用没有终端用户登录态。未执行生产账号下的云函数业务写入；无真实客户数据验证。
- WP01 门禁：`PASS_WITH_LIMITATIONS`；自动检查通过，仍列出 `login`、`service-runtime`、`live-writes`、`mobile` 未验证。隔离浏览器回归 108 项通过、5 项既有跳过；匿名探针 65/65 通过。

## 发布结果

Git 提交与发布标签由 `tools/release.ps1` 在部署与门禁通过后生成；发布后以仓库 `HEAD` 与对应 `release-20261016-*` 标签为准。线上地址：<https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html>。
