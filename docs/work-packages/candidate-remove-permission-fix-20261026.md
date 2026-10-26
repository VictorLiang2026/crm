# 候选人移除权限错误修复（2026-10-26）

## 范围与影响

- 修复人物详情中移除人物专属候选人时的 `permission denied for table persons`。
- `customer_id IS NULL` 的候选人改走现有 `person_360.removePersonOnlyRecruit` 受控服务端入口；客户关联候选人继续使用现有 `recruit_candidates.remove` 流程。
- 保持候选人及同批招募跟进软删除、回收站恢复行为；无数据库迁移、权限变更或云函数变更。
- 影响文件：控制台数据路由和移除确认操作；新增路由浏览器回归并纳入 `test:pc19`。

## 验证

- 改前基线：本地/GitHub 同为 `3c6537d`；此前发布已核对 29 个 CRM 云函数。当前包不修改云函数。
- `npm run test:pc19`：10 项通过。
- `node --test tests/pc19/recruit-remove-routing.browser.cjs`：1 项通过，覆盖人物专属与客户关联两种入口。
- WP01 发布门槛：`PASS_WITH_LIMITATIONS`，108 项回归通过、0 失败、5 项既有跳过；75 项匿名探针通过；`public` 权限目录 1104 项检查无漂移。
- 精确上传 `crm/js/modules/console/data.js`、`write.js` 后，线上 `admin.html` 与 84 个可达页面/模块/样式文件内容一致。未改动云函数，云函数全量下载在本轮因耗时中断，以上一轮完整核对为基线。
- 未使用真实客户或候选人数据执行删除；未做生产写入验证。

## 回滚

- 回滚本次发布提交，并重新上传回滚版本的 `crm/js/modules/console/data.js` 与 `crm/js/modules/console/write.js` 到 `/crm/js/modules/console/`。
- 数据库与云函数无需回滚。
