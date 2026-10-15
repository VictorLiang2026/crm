# 今日页“优先行动”卡片报错修复（2026-10-15）

## 变更范围

- 根因：最近结束的行动没有优先级等级，但行渲染器直接按等级解构徽标配置，导致 `undefined is not iterable`，整张行动卡片加载失败。
- 修复：历史行动显示其完成/取消状态徽标；开放行动的优先级展示不变。
- 同步 PC09 已发布的 4 个 `data.js` 关系接口，使本地源码与当前生产、GitHub master 一致。PC09 代码和安全基线已在 `release-20261015-194500` 发布，本记录不重复修改其行为或数据库。
- 页面影响仅限 Today“优先行动”卡片。未修改云函数、数据库、权限及其它页面。

## 验证

- `node --check`：今日页模块通过。
- `node --test tests/pc06/work-items.browser.cjs`：通过；展开“最近结束”后可见已完成行动，且页面无数据加载失败。
- `npm run test:modular`：通过。
- `npm run test:wp01`：WP01 门槛 `PASS_WITH_LIMITATIONS`；隔离回归 108 项通过、5 项按既有配置跳过；匿名对象检查 64/64 通过；catalog 与 WP04 身份审计通过。
- 发布前 `sync-check.ps1 -CloudOnly`：54 个可达静态文件、29 个云函数和 181 个源码/配置文件与生产一致。
- 部署后读取线上 `today.js`：HTTP 200，SHA-256 与本地一致。
- 未完成真实用户会话下的线上页面操作；登录、service_role 运行时、线上写入及手机端仍按 WP01 标为未验证。

## 发布与回滚

- 仅上传 `crm/js/modules/console/pages/today.js` 到 `/crm/js/modules/console/pages/today.js`；没有云函数或数据库部署。
- 回滚不涉及数据：从发布前 GitHub master (`release-20261015-194500`) 取回该文件，上传回同一托管路径，并创建新的恢复提交与标签。
