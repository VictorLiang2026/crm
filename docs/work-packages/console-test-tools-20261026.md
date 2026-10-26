# Console 受控测试工具迁移发布记录

日期：2026-10-26。工作包：把受控虚构测试场景和预填下一步行动接入 `console.html`。

## 范围与兼容

- 新增 Console `#/test-scenario`、`#/test-scenario/action`，设置页入口指向 Console；沿用 `assistant.testSamples`、`assistant.command`、`person_360.search`，以及既有登录和服务端权限。没有数据库、权限或云函数变更。
- 旧 `admin.html` 和旧 hash 路由保留。测试场景创建仍需服务端预览、身份确认、执行；行动创建仍需人工选 Person、Plan、服务端 Preview、Confirm、Execute。候选身份不由 AI 自动选定。
- 新页使用 Console 中英文字典，默认简体中文；仅面向 iPad 现有布局。
- 场景中的测试日程链接在 Console 指向“今日经营”；旧页面独有的日程展开动作仍可在旧 URL 使用。该差异不影响测试场景创建或预填行动链路。

## 发布范围

仅静态托管 `/crm/js/modules/console/test-tools.js`、`i18n.js`、`router.js`、`views.js`、`pages/settings.js` 和 `/crm/css/console.css`。不上传项目目录、不部署云函数、不触碰业务数据。

## 验证

- `node --check` 对新增及修改的 JavaScript 文件通过；`git diff --check` 通过。
- `node --test --test-force-exit tests/console/test-tools.browser.cjs tests/wp03/run.test.cjs tests/wp03/browser.test.cjs`：19/19 通过，涵盖授权拒绝、两次人确认、旧测试路径及新 Console 页。
- `node --test --test-force-exit tests/console/more-navigation.browser.cjs`：1/1 通过。
- `npm run test:wp01`：记录在本轮安全报告；自动回归 108 PASS、5 个既有 SKIP。真实业务写入、服务角色运行时和人工登录以报告为准，不用静态哈希代替。
- 发布前 `npm run check:release-gate`、发布后静态 SHA-256 与 GitHub 标签核对，另见本轮最终交接。

## 回退

回到发布前标签 `release-20261026-175124` 对应的六个静态文件，再以恢复提交发布新标签；不要直接改业务数据。旧 `admin.html` 路由一直保留，可在确认问题时作为受控临时入口。数据库无须回滚。

## 未纳入

客户机会历史维护、旧 AI 与活动专项能力取舍、子记录删除、`admin.html` 的停用/删除及站点默认首页切换，均需独立工作包。既有未提交的 PC36 文档与保险知识库目录保留，不纳入本次提交。
