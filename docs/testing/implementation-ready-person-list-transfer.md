# 人物名单导入/导出 — 实施与发布前记录

日期：2026-11-09  
基线提交：`ee050cab0ea4c3580a004baa3be8b5b32b536a3b`  
基线标签：`release-20261109-063946`

## 实施范围

- 「更多 → 常用工具」新增“人物名单导入/导出”，使用 `#/people-list-transfer` 独立路由；旧 `#/people/import` 附件/OCR 导入流程保持原样。
- 新页面提供 CSV、XLSX 名单导入；浏览器本地读取文件，AI Gateway 只接收列标题并给出字段映射建议，不接收名单行内容，也不判断人物身份。
- 人名沿用 `PersonService.resolveName()` 的括号前主体比对。PersonID 和姓名主体不一致、候选过多、或尚未处理的姓名候选会阻止确认。高置信电话/微信匹配只作建议，最终由用户选择。
- 同一人更新沿用人物资料受控写入 RPC 和版本核对；不同人物的旧姓名限定词调整与新人物创建准备为一个 `public` 原子 RPC，避免半完成写入。
- 字段策略默认保留系统值、只补空值；支持整批覆盖/备注与兴趣合并，以及仅针对冲突字段的覆盖策略。空导入值不会清除资料。
- 导出固定包含 `PersonID`、`display_name`，其他字段按系统字段名选择；按 500 条游标分页读取全部未软删除人物，再生成 CSV 或 XLSX。
- 新增界面文字通过 Console i18n 提供简体中文和英文，按 iPad 页面核验。

## 数据库变更

- `20261109160000_person_list_transfer_commands.sql` / `.rollback.sql`：新增服务端专用的短期预览命令表，RLS/force RLS，服务角色仅有 SELECT/INSERT/UPDATE；确认态使用 `ready` 状态。
- `20261109170000_person_list_transfer_atomic_create.sql` / `.rollback.sql`：新增受控原子 RPC，锁定并校验被改名人物版本后，在同一事务内改名并创建导入人物。
- 两组 migration 已按用户确认应用于生产 `public` schema；`listMigrations(limit=200)` 确认版本 `20261109160000` 和 `20261109170000` 均登记。CloudBase `applyMigration` 对两项均返回 `MIGRATION_NOT_APPLIED`，但相应任务状态为 `Succeed`；随后迁移历史、migrationDetail、表/RPC 目录及权限查询均确认对象实际已落地，因此没有重试，避免重复执行。
- 生产只读核验：新命令表 0 行、RLS 与 FORCE RLS 开启；anon/authenticated 均无表权限，service_role 仅有 SELECT/INSERT/UPDATE；原子 RPC 为 SECURITY INVOKER，仅 service_role 可执行。
- 两组文件已复制到 `C:\Users\victor\cloudbase\migrations`，与仓库文件逐个 SHA-256 对照一致。没有改动任何其他 schema。
- Migration 不改基表字段或视图。Rollback 不使用 `CASCADE`；暂存表 rollback 会拒绝尚未完成的确认/执行批次。

## 回归证据

- `tests/person-list-transfer/*.test.cjs`、`tests/console/more-navigation.browser.cjs`、`tests/more-consolidation/l04b-person-file.browser.cjs`：26 项通过；新增的安全目录/migration 测试 8 项通过。覆盖字段映射仅传列标题、CSV BOM/转义/多行、XLSX 本地解析与往返、行号、姓名主体候选、同一/不同人物、限定词、冲突字段策略、PersonID 冲突、候选上限、确认状态、并发执行、失败重试、分页导出及生产对象权限。
- `npm run test:pc03`：4 项通过，覆盖 More 入口及旧路由/static 行为。
- `npm run test:person-service`：9 项通过。
- `npm run test:pc04`：8 项通过，人物目录与资料编辑相邻回归通过。
- `npm run test:ai-gateway`：18 项通过；`npm run test:ai-skills`：11 项通过。
- `npm run check:shared`、`npm run test:modular`、变更 JS `node --check`、`git diff --check` 均通过。
- 浏览器回归检查英语/中文入口、示例名单渲染及 820×1180、1180×820 两种 iPad 视口无横向溢出。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`，发布阻断项为 0；生产公开对象目录 1,262 项检查通过（70 张表、12 个视图、39 个序列、92 个函数），匿名探针 82/82。WP02 18/18，WP04 身份审计 `PASS_WITH_EXCEPTIONS`（保留 3 项已有明确记录的例外）。
- `npm run check:release-gate`：通过；`npm run check:shared`：60 份共享副本 / 30 个函数一致；`npm run test:modular` 通过。

## 生产部署与核验

- 云函数 `assistant`、`ai_activity`、`person_360` 均部署成功。AI Gateway 提示已同步到 `_shared`、`assistant`、`ai_activity` 三份副本。
- 静态托管逐文件上传 10 项：Console `console.css`、`data.js`、`i18n.js`、`pages/misc.js`、`router.js`、`views.js`、两个名单导入/导出模块、SheetJS 0.20.3 本地资源和许可证。
- `tools/sync-check.ps1 -CloudOnly`：主页面 SHA-256 一致；98 个可达页面/模块/样式资源一致；30 个云函数的 245 个源码/配置文件一致。
- 本轮未以真实 CRM 账号登录，也未执行人物导入写入、AI 实际映射或导出业务验收；生产登录、业务写入和服务运行时写探针仍未验证。隔离回归不能替代这些线上业务验收。

## 未验证项

- 尚未用 CRM 账号登录生产页面；未请求真实 AI 映射，也未执行线上人物写入/导出。
- 人工登录、生产业务写入/导出及服务角色写入探针仍未验证；需由获授权账号在 CRM 页面完成线上业务验收。

## 待发布清单与回滚

- Migration：上述两组 SQL 与 rollback。
- 云函数：`person_360`、`assistant`、`ai_activity`（为保持 AI Gateway 副本一致）。
- 页面资源：`crm/css/console.css`；`crm/js/modules/console/{data.js,i18n.js,pages/misc.js,router.js,views.js,person-list-transfer.js,person-list-transfer-file.js}`；`crm/js/vendor/sheetjs-0.20.3.full.min.js` 与许可证。
- 生产 migration、函数与静态资源已部署；代码提交 `68153a01f13e725b5469e65721214808df5d2c8e` 已推送至 GitHub `master`，代码发布标签为 `release-20261109-105836`。
- 推送后完整 sync-check 通过，Local / GitHub / CloudBase 的页面资源、30 个函数与 245 个源码/配置文件一致。生产入口为 `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。
- 若只撤回代码：恢复发布前两个函数及列出的页面资源。数据库对象回滚分别运行配对 rollback；在回滚命令表前先确认没有未完成确认/执行批次。已经导入的人物资料不由 schema rollback 删除，需按数据影响另行评估。
