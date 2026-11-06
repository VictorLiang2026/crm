# 2026-11-06 知识库审核并生效修复

## 范围与原因

- 修复“知识与策略”中，来源关联的 evidence 草稿点击“审核并生效”失败的问题。
- 前端此前在来源与提取状态均为 draft 时调用 `review`，绕过生产 `crm_knowledge_set_valid_v1` 对空 confidence 填入 `0.8` 的路径；数据库约束随后拒绝缺少 confidence 的已审核 evidence。
- 现在该按钮统一调用 `setValidity`，仍提交列表中的 `expectedUpdatedAt`。服务端继续执行状态核实、置信度补齐、来源审核与审核人审计。没有数据库或云函数变更。

## 修改文件

- `crm/js/modules/console/knowledge-governance.js`
- `tests/pc22/knowledge-governance.browser.cjs`
- `tests/knowledge-library/generated-review.test.cjs`

## 回归与安全检查

- 知识治理浏览器回归：3/3 通过。
- `npm run test:pc22`：15/15 通过。
- WP04 新鲜只读身份审计：8/8 通过，保留 3 条已登记身份例外。
- `tests/knowledge-library` 全部测试文件串行执行通过；并发启动浏览器文件时出现过 fixture 超时，逐文件复跑均通过。
- WP01：`PASS_WITH_LIMITATIONS`；public catalog 1,248 项通过，回归 108 项通过、5 项历史预设跳过，匿名探针 81/81 通过。真实登录、service runtime、线上业务写入与移动设备验收未执行。
- 使用 CloudBase 代码审查指引复核：前端仍走 `callFn`/`assistant` 入口；保留服务端授权、审核人身份与乐观并发条件；未新增数据库直连或单语言界面文本。

## 部署与回滚

- 只上传 `crm/js/modules/console/knowledge-governance.js` 到 `/crm/js/modules/console/knowledge-governance.js`。
- 数据库与云函数产物不变。
- 回滚：从本次发布前 GitHub master 恢复该模块文件并重新上传同一路径；不需数据库回滚。

## 生产验证边界

- 没有对线上知识记录执行审核或其他写操作。
- 发布后只核对静态资源与源码同步，不代替真实用户再次点击审核。