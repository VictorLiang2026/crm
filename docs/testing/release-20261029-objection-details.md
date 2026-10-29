# WP03：异议处理内容默认折叠

日期：2026-10-29

## 范围

个人详情页的 AI 对话策略结果保持异议原文可见；深层原因、澄清问题、回应思路、下一步目标、避免事项、知识引用、生成时间和重新生成入口放在可展开区域中。默认折叠，点击“查看正文与引用”展开，再点击收起。英文使用现有 i18n 键 `kg_view_content`。

## 文件与影响

- `crm/js/modules/console/pages/person.js`：调整 AI 异议策略结果的展示层级。
- `crm/css/console.css`：明确控制闭合状态下正文不可见，确保不同 Chromium 版本中答案内容都不会占位或露出。
- `tests/pc23/playbook-details.browser.cjs`：新增离线浏览器回归，使用虚构数据。
- 不涉及 `admin.html`、云函数、数据库、权限或线上业务数据。

## 验证

- `node --test tests/pc23/playbook-details.browser.cjs`：通过。验证默认收起时只显示异议、正文及引用不可见；展开后展示处理建议与引用；再次点击可收起；中英文提示均正确；iPad 竖屏和横屏无横向溢出。
- `npm run test:wp01`：通过，PASS_WITH_LIMITATIONS。独立浏览器 regression 108 通过、0 失败、5 项历史预设跳过；匿名访问 77/77；public 安全目录 1166 项通过；WP04 identity audit 通过，保留 3 项已声明异常。
- `npm run check:release-gate`：通过；报告保留登录、service runtime、live writes、mobile 四项未验证状态。
- 本工作包未执行真实客户数据写入，也未调用 AI 或外发消息。

## 回滚

恢复本提交涉及的 `person.js` 与 `console.css` 到上一发布标签，并按静态托管流程重新上传这两个文件。测试和此记录可随回滚提交恢复；无数据库回滚事项。

## 发布后核对

部署范围：`/crm/js/modules/console/pages/person.js`、`/crm/css/console.css`。CloudOnly 已确认 90 个可达页面资源与线上一致，并核对 29 个 CRM 云函数的 228 个源码/配置文件；完整 GitHub/云端同步检查在提交发布后执行。
