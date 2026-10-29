# 2026-10-29 Quick Capture 单一行动计划

## 范围

- Quick Capture 针对一次互动只显示一个 AI 行动计划，将 AI 建议和明确约定合并在同一张计划卡中。
- 保存互动后最多提供一次计划待办预览入口；服务端预览、人工确认和执行流程保持不变。
- 命中一条既有行动/承诺时可打开该事项核对；命中多条既有事项时不新增重复待办。计划正文超出单条待办长度上限时要求人工精简。
- 从人物页手工新建行动或承诺的入口不变。Legacy Quick Capture 逐条行为保留。
- 仅更新 `crm/js/modules/console/write.js`、`crm/js/modules/console/i18n.js`，无云函数、数据库、权限或生产客户数据变更。

## 验证

- `node --test tests/pc37/quick-capture-focused.test.cjs tests/pc37/quick-capture-focused.browser.cjs`：11 项通过。
- `npm run test:modular`：通过。
- `npm run test:actions`：5 项通过。
- `npm run test:commitments`：9 项通过。
- `npm run test:interactions`：26 项通过。
- `npm run test:wp01`：安全报告 `PASS_WITH_LIMITATIONS`；94 项隔离回归通过、5 项历史预设跳过、匿名检查 77/77 通过。手工登录、服务运行时读写、线上业务写入及移动端验收未执行。
- `npm run check:release-gate`：通过；开放项仍为真实登录、service runtime、生产写入和 mobile。
- 修改前基线：`cf24dec`；CloudOnly 页面、90 个可达资源、29 个 CRM 函数/228 个源码配置文件一致。

## 发布与恢复

- 部署仅包含 `/crm/js/modules/console/write.js` 和 `/crm/js/modules/console/i18n.js`，上传均成功；两文件线上 GET 内容与本地 SHA-256 一致。
- 无数据库迁移或数据回滚事项。恢复时从本记录对应发布的父提交重新上传这两个文件即可。

## 未验证事项

- 未用真实客户数据执行保存；交互行为通过隔离浏览器夹具覆盖。
- 没有执行真实账号登录或生产写入；安全门禁按报告保留限制项。
