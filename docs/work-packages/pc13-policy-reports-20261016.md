# PC13 — Person 保单检视报告

日期：2026-10-16  
基线：`0768f526fb9bb5b88394c23bcb312b86727750d0`（PC12 已发布）

## 交付范围

- 在 Person 的保险页签增加既有 `policy_review_reports` 报告历史、生成入口和人工修订。
- 报告按生成时间倒序展示；可查看五个报告段落、原始生成文本、报告 ID、生成时间和产品明细版本。
- 人工修订只写入 `edited_*` 字段。AI 原文及原始输出保留；展示沿用 Legacy 的“非空人工修订优先”规则。
- 后续生成时，历史报告上下文优先带入非空人工修订，避免模型忽略人工核实结论；新报告仍追加，不覆盖历史。
- 产品版本从 PC12 `public.products.version` 读取并写入报告。旧报告和生成时无产品行的报告显示“未记录”。不保存客户信息快照。
- 无有效客户关联的 Person 不触发报告服务。报告与建议仍需人工核实，不自动改写保额、人物事实、机会或行动。
- 保留 Legacy 报告入口与服务动作。没有新增 Route、云函数或手机适配。

## 数据库

- Migration：`20261016070413_policy_review_report_version.sql`
- Rollback：`20261016070413_policy_review_report_version.rollback.sql`
- 仅在 `public.policy_review_reports` 增加可空正整数 `input_products_version`。旧数据为 NULL。此前已核对没有依赖该表的 public view。
- 生产迁移已由 CloudBase PostgreSQL migration 执行并校验成功：task `task-d5053f01217844f7`。只读 schema 核验显示新列为 nullable integer，无默认值。
- migration/rollback 已同步 `cloudbase/migrations/` 与 `C:\Users\victor\cloudbase\migrations\`。

## 修改文件

- `crm/js/modules/console/insurance-reports.js`
- `crm/js/modules/console/pages/person.js`
- `crm/js/modules/console/data.js`
- `crm/js/modules/console/i18n.js`
- `crm/css/console.css`
- `cloudfunctions/policy_review_reports/index.js`
- migration/rollback、PC13 测试与本记录

## 验证

- `npm run test:pc13`：通过 4 项（含生成输入版本及人工历史上下文的云函数隔离测试）。
- `npm run test:pc12`：通过 9 项。
- `npm run test:pc11`：通过 3 项。
- `npm run test:modular`：通过。
- `npm test`：通过，108 PASS、0 FAIL、5 个既有跳过。
- `npm run test:person-service`、`test:households`、`test:interactions`：通过。
- WP01 发布门槛：`PASS_WITH_LIMITATIONS`；public 目录检查 881 项通过，匿名探针 64/64 通过，WP04 身份审计为 `PASS_WITH_EXCEPTIONS`（3 条既有明示例外）。人工登录、service_role runtime、真实业务写入与手机真机项未验证。
- PC13 浏览器回归覆盖 iPad 横竖屏布局、报告生成入口、未关联身份阻断、人工修订只更新 `edited_*` 并保留 AI 原文。
- 发布后通过云函数只读 `list` 动作核对测试客户 #788，返回既有测试报告 #3；其产品版本为 NULL，符合历史报告兼容规则。未在生产触发真实模型生成。
- CloudOnly 复核通过：58 个页面可达静态资源、29 个 CRM 云函数及 183 个源码/配置文件均与本地一致。
- 未使用真实客户资料做破坏性验证；service_role runtime、真实创建/更新和真实 AI 生成仍未验证。

## 发布与恢复

- 只部署本记录列出的模块/CSS 与 `policy_review_reports` 云函数；不上传整站或其他函数。
- Git 发布前运行 `npm run check:release-gate` 与 `tools/sync-check.ps1 -CloudOnly`；部署后执行完整 `sync-check.ps1`，再发布提交与标签。
- 如需回滚数据库字段，先确认依赖新字段的函数/页面已停用或回滚，再执行配对 rollback。rollback 会移除该列及已写入的新版本值。

## 顺序边界

PC13 发布后暂停在 PC14 的专属确认点；不会仅凭“PC13 及之后范围已确认”自动执行 PC14 中涉及关键数据影响的操作。
