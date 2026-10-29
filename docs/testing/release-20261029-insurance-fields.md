# 2026-10-29 保单字段调整

## 范围与影响

- Person 保单明细和旧 `admin.html` 保单录入入口统一为：保额、总保费、已交保费、年交保费、更新日期；新增客户级“客户当前保单情况说明”。
- iPad 编辑区五项字段保持同一行，说明文本框在类别列表下方。手机断点沿用原双列排版。
- 保单报告生成、AI 推荐与 Person 360 保单上下文读取新字段；说明文本以人工录入、未经核实的来源信息传递。
- `public.products.ap_*` 改为 `numeric(21,2)`；新增 `current_policy_description`；`items` JSON 只保存新字段名。
- `public.products_view` 重建后保留原查询列、security_invoker 和角色授权。远端曾因默认 ACL 给 `authenticated` 多授全部权限，已用后续迁移 `20261029121000` 撤销，复核结果为原授权。

## 数据迁移

- 迁移版本 `20261029120000_products_insurance_fields`：线上 2 行产品记录均有有效数组 JSON。保额、更新日期与旧年交保费保留并映射；旧交费年限、已交年数清除；总保费、已交保费留空。
- 聚合复核确认 2 行均只含新键，旧键为 0；旧年交保费均符合最多两位小数约束。
- 迁移版本 `20261029121000_products_view_authenticated_privilege`：恢复视图原有读取授权，不改 `public` 以外对象。
- 配套 rollback 文件在同目录。若说明、总保费/已交保费有新值，或保额已含小数，主 rollback 会停止，避免丢失新录入数据。
- CloudBase 两次 `applyMigration` 响应的校验标志均误报未应用；逐次用远端 `listMigrations`、`migrationDetail` 和只读结构/授权查询确认版本及实际状态均已应用。未重复提交迁移。

## 回归结果

- `npm run test:pc12`：10 项通过，覆盖金额精度、兼容旧缓存输入、版本冲突、保存说明文本及 iPad 768/1024 宽度布局。
- `npm run test:pc13`：5 项通过，覆盖报告、人工编辑及新保单上下文。
- `tests/households/insurance-context.cjs`：6 项通过。
- `node tests/tooling/modular-frontend.mjs`：通过。
- Admin 内联脚本语法检查：2 个脚本通过。
- `npm run build:shared`、`npm run check:shared`、`git diff --check`：通过。
- 修改前 CloudOnly 基线核对：线上页面及 90 个页面资源一致；29 个 CRM 云函数的 228 个源码/配置文件一致。

## 发布状态

数据库迁移已应用并复核。2026-10-29 已部署以下产物：

- 页面文件：`/crm/admin.html`、`/crm/css/console.css`、`/crm/js/modules/console/i18n.js`、`/crm/js/modules/console/insurance-editor.js`、`/crm/js/modules/console/pages/person.js`。托管上传结果 5/5 成功。
- CRM 云函数：`products`、`person_360`、`policy_review_reports`、`ai_recommend`，逐个部署成功。
- 部署后 `sync-check.ps1 -CloudOnly`：主页面哈希一致，90 个引用页面资源一致；29 个 CRM 函数的 228 个源码/配置文件一致。
- `tests/wp01/static.cjs`：90 个页面资源线上一致。
- 运行时只读探测：`products` 的虚构最大 Person ID 返回 `PERSON_NOT_FOUND`；`policy_review_reports` 和 `ai_recommend` 的缺少 customer_id 参数均按预期拒绝。`person_360` 在无登录身份下返回 `UNAUTHORIZED`，因此没有以生产身份验证其业务查询分支。
- 发布门禁为 `PASS_WITH_LIMITATIONS`：关键目录、回归与匿名 77 项均通过；人工登录、service-role 完整业务运行、生产写入及真实手机视觉验收未执行。iPad 五字段同一行/说明框在下方的本地浏览器回归已覆盖 768px 和 1024px。

Git 发布通过 `tools/release.ps1` 创建提交标签并进行发布后完整一致性核验；最终提交和标签记录在发布结果中。
