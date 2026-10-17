# PC25 发布记录

- 发布提交：由 `release-20261017-134738` 标记的 master 提交（提交哈希见发布结果）。
- 发布标签：`release-20261017-134738`。
- 前一发布基线：`0318862d4b91e53dd84075d9ce603f36d0b60d09`（`release-20261017-014100`）。
- CloudBase 环境：`crm-d1gkae8ddc930d151`。
- 静态入口：<https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html>。

## 发布范围

- 云函数：仅部署 `assistant`，通过 `tools/deploy-function.ps1 -Function assistant`。
- 静态文件：仅上传 Console `data.js`、`i18n.js`、`pages/misc.js`。
- 数据库：没有 schema 或业务数据变更，无 migration。
- GitHub：发布脚本将提交 PC25 工作包、创建发布标签并原子推送 `master` 与标签。

## 验证证据

- `npm run test:pc25`：21/21 通过。
- `npm run test:ai-gateway`：14/14 通过；AI Gateway 使用 CloudBase 已配置模型，不绑定厂商。
- assistant 历史入口和 PC23 回归：26/26 通过；PC24 SearchV2：19/19 通过。
- PC25 iPad 浏览器场景：通过中文澄清、人工人物选择、来源摘要、文本安全渲染、英文今日计划及横竖屏尺寸检查。
- `npm run test:wp01`：108 PASS / 0 FAIL / 5 SKIP；catalog 937 项无漂移；匿名权限 66/66；WP04 身份审计通过，保留 3 项已声明的参与人映射例外。
- `npm run check:release-gate`：通过，存在环境文档列出的登录态与生产服务调用限制。
- CloudBase CLI 实际调用已验证 assistant 登录门禁：无登录上下文返回 `UNAUTHORIZED`，在 AI Gateway 和业务数据访问之前结束。
- CloudOnly 最终一致性：66 个页面/模块/样式资源匹配；29 个 CRM 云函数、190 个源代码/配置文件匹配，包含 assistant。
- 无真实 Person、Fact、Opportunity 或 Action 写入。

## 限制

没有使用真实登录态调用生产模型或真实人物业务数据；因此生产登录态下端到端 AI 模型调用仍未验证。只验证了隔离测试中的执行器流程、浏览器 UI 与真实云函数登录门禁。AI 审计写入不构成业务数据写入。

## 回滚

Git 回滚基线为 PC24 标签 `release-20261017-014100`。静态文件可从该版本恢复，`assistant` 可部署该版本函数源码。PC25 没有数据库变更。
