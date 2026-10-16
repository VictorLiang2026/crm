# PC16 活动创建编辑与准备任务整合

日期：2026-10-16  
基线：`fb54106b1d44872ea59597c66eeb69198e7451ae` / `release-20261016-120700`

## 范围与结果

- Activities 列表新增活动表单；详情可编辑和软删除活动，保持现有字段、状态、旧 URL 与 `activities` 数据契约。
- 准备任务支持新建、编辑、完成、跳过和删除。保留旧 `activity_tasks` 接口；任务不创建重复 Action。完成/跳过状态维护 `completed_at`。
- 删除活动前显示服务端影响预览：活动参与者记录按既有语义软删除；准备任务和 Actions 保留。提交时核对活动版本和参与者行数；旧的 `remove` action 不变。
- 日报按钮保留可用的旧客户活动日报入口。新界面文案通过 `i18n.js` 提供简体中文与英文，布局仅按 iPad 验收。
- 仅活动控制台模块与 `activities`、`activity_tasks` 云函数受影响；无数据库对象、字段或权限变更，仅 `public` 业务表经既有服务函数访问。`admin.html`、其他函数、legacy 路由和旧 action 不改。

## API 与兼容

- `activities` 增加 `updateConsole`、`previewRemove`、`removeConsole`；旧 `create/update/updateStatus/remove` 保留。
- `activity_tasks` 增加 `updateConsole`、`transitionConsole`、`removeConsole`；旧 CRUD 与状态 action 保留。
- Console 更新携带版本时间戳，拒绝过期写入；任务写入限定活动 ID，并检查活动仍有效。
- 活动删除服务端重新核验活动版本与参与者数量。沿用旧参与者级联软删除；相关准备任务及 Actions 不级联删除。

## 验证

- `npm run test:pc16`：2/2 通过；虚构数据浏览器场景覆盖活动新增/编辑/删除预览确认、任务新增/编辑/状态/删除确认、中英切换及 iPad 横竖布局。
- 活动与互动、复盘、Today 回归：27/27 通过。
- `npm run test:modular`、`npm run check:shared`：通过；29 个函数的 58 份共享模块副本一致。
- `npm run test:wp01`：108 PASS、0 FAIL、5 SKIP；发布门 `PASS_WITH_LIMITATIONS`，匿名探针 65/65。`npm run check:release-gate` 通过。
- 部署后无副作用调用 `activities` 与 `activity_tasks`，两者均返回预期的 `unknown action: pc16_deploy_probe_invalid`，证明线上函数可执行；没有触发数据库写入。
- `sync-check.ps1 -CloudOnly`：线上 60 个可达静态页面/模块资源及 29 个函数、184 个源码/配置文件与本地一致；线上 `admin.html` HTTP 200 且哈希一致。
- 未使用真实客户数据；未做真实业务写入。

## 发布与回滚

- 发布范围：云函数 `activities`、`activity_tasks`；静态托管仅上传 5 个控制台 JS/CSS 文件。无迁移。
- CloudBase 静态托管：https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html 。提交、标签与 GitHub 推送核验在 Git 发布完成后补录。
- 回滚基准：`release-20261016-120700`。恢复两个函数及被覆盖静态文件至该标签内容，再按环境文档重新部署和创建恢复提交；不回滚业务数据。

## 未验证项

- 未在真实登录会话中执行线上活动/任务写入；WP01 的 login、service-runtime、live-writes 仍未验证。函数探针只验证部署后执行，不等同真实业务流程验证。
- 活动软删除的既有实现由两个后续更新构成，非单个数据库事务；本次增加预览和版本/数量复核，但保留原有删除语义及其事务边界。
- 未做手机页面适配验收。
