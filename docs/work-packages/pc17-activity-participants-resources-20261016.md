# PC17 活动参与者签到和资源管理

日期：2026-10-16
基线：`f15c0f11494e509760530cbe90ebb4938888e8f6` / `release-20261016-123337`

## 范围与结果

- 活动参与者可通过服务端 Person 身份解析、人工选择和确认后新增或关联；无法确认身份的姓名只能明确暂存为未关联记录。
- 参与状态支持邀请、出席、缺席，并以活动范围、原状态和 `updated_at` 做并发保护。签到只记录参与事实，不自动写入 Interaction。
- 嘉宾档案提供原生创建、编辑、Person 关联、启停和影响预览删除；嘉宾仍保留独立档案信息。
- 活动主题池提供创建、编辑、启停、按活动分配和影响预览删除。已被历史活动引用的主题不能删除，改为停用以保留历史。
- 新界面通过 `i18n.js` 字典提供简体中文与英文，布局只按 iPad 验收。恢复原有 CSS 900px 规则，PC17 的窄屏布局规则仅适用于 iPad 竖屏，不改变旧页面手机规则。
- 保留原 `activities`、`activity_speakers`、`activity_topics`、`person_360` 路由与旧 action；没有数据库 schema、权限或迁移变化。业务查询和写入仍限于 `public`，未访问 `pr` 或 `pr_*`。

## 数据和兼容性

- 保持 `activity_participants.person_id`（按 `person_type` 指向旧实体）与 `canonical_person_id`（Person 主键）分开使用；新增关联时验证 Person 存在、未删除、名称解析候选匹配、无重复行和版本未变化。
- 新增 `activities.updateParticipantConsole`、`activities.applyTopicsConsole`、`activity_speakers.previewRemoveConsole/removeConsole`、`activity_topics.previewRemoveConsole/removeConsole` 与 `person_360.linkCanonicalParticipant`。Console 写入限定目标活动/资源并检查版本；旧接口没有替换。
- 删除嘉宾会统计参与者历史引用；删除主题会统计所有活动（包括已删除活动）的历史引用。发现引用时拒绝删除并提示停用。
- 主题分配仍沿用现有 `topic_ids` 与使用计数行为。活动主题保存及使用计数是既有函数内连续写入，不在本轮引入数据库事务。

## 验证

- `npm run test:pc17`：4/4 通过；覆盖 Person 人工确认、姓名暂存/关联、状态变更、嘉宾/主题管理、英文 UI 和 iPad 横竖屏无溢出。
- `npm run test:pc16`：2/2 通过。
- `npm run test:pc13`：4/4 通过；`npm run test:pc14`：7/7 通过；`npm run test:pc15`：5/5 通过。
- `npm run test:interactions`：26/26 通过；参与和签到不会重复产生 Interaction。
- 活动 schema/canonical/speaker regression：7/7 通过；Today 与行动回归：14/14 通过。
- `node --check`：本轮 5 个受影响云函数 JS 文件语法通过；`npm run check:shared`：29 个函数的 58 份共享模块副本通过；`npm run test:modular` 通过；`git diff --check` 通过。
- `npm run test:wp01`：108 PASS、0 FAIL、5 个历史 skip；匿名探针 65/65；release gate `PASS_WITH_LIMITATIONS`，无阻断项。catalog 检查 907 项、无差异；公开 schema identity audit 保留 3 条既有例外。
- `npm run check:release-gate`：通过。未验证项仍为真实登录、service runtime、线上业务写入和手机验收。
- 未用真实客户数据；测试中的身份、人物和资源均为虚构样本。浏览器流程采用隔离测试 API，没有写生产数据。

## 发布与恢复

- 云函数发布范围：`activities`、`activity_speakers`、`activity_topics`、`person_360`，四个函数代码更新均成功。
- 静态托管发布范围：`activity-people.js`、`pages/activities.js`、`data.js`、`i18n.js`、`console.css`，5/5 上传成功；不上传 `admin.html` 或整个项目目录。无数据库迁移。
- 部署后用未知 action 无副作用探测：`activities`、`activity_speakers`、`activity_topics` 实际运行并返回预期 `unknown action`；`person_360` 实际运行并按无登录身份保护返回 `UNAUTHORIZED`。MCP invoke 因 CAM auth 失败后改用 CLI 验证。
- `sync-check.ps1 -CloudOnly`：线上 61 个可达静态资源及 29 个函数的 184 份源码/配置与本地一致；`admin.html` HTTP 200、哈希一致。
- Git commit 与 release tag 由本轮 `tools/release.ps1` 创建；完整同步核验由发布脚本在推送后执行。线上地址：<https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html>。
- 回滚基准：`release-20261016-123337`。恢复这四个函数和本轮上传的静态文件至该标签版本，再按发布流程创建恢复提交；无业务数据回滚。

## 未验证项

- 未在真实登录会话中进行线上参与者/嘉宾/主题写入。部署后的无副作用函数调用只证明函数可执行，不等同于线上业务流程验证。
- 未执行手机布局验收；按任务边界本轮不主动设计或验收手机适配。
