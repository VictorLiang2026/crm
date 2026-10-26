# P3g：活动主题 AI 推荐进入 Console

日期：2026-10-27。基线 `5bf99f170d44b8ef1a0646f42a611440210ebfef`，回退标签 `release-20261027-072554`。

## 范围与影响

- Console 活动详情“嘉宾与主题”增加 Gateway 主题建议。只从 `public.activity_topics` 的在用且未选入本场主题中推荐；最多分析使用较多的 20 项。服务端校验真实登录、活动状态与模型推荐 ID。
- 建议不写业务数据；点击建议只勾选页面上的现有主题，仍由操作人员检查并点击原“保存主题”按钮，保留旧活动 ID、冲突预期版本与计数语义。
- 旧 `admin.html` 主题推荐与 `ai_activity.recommendTopics` 保留，待真实账号验收后单独退出。数据库对象、权限、既有业务记录和模型配置不变。
- 页面、接口、数据影响限于 `ai_activity` 建议 action 与 Console 活动资源页；`assistant` 仅同步技能契约。登录、客户、跟进、活动、招募、回收站纳入跨模块回归。

## 验证与发布

- 模拟覆盖匿名拒绝、结束状态、空主题池、已选/停用/伪造/重复 ID 过滤及无业务写入；浏览器模拟覆盖中英双语、iPad 宽度、勾选后仍未保存。
- 真实账号下模型输出质量和人工保存真实业务记录未验证，不据此退出旧入口。
- 只部署 `ai_activity`、`assistant`，以及 `crm/js/modules/console/activity-topic-recommend.js`、`activity-people.js`、`data.js`、`i18n.js`；不上传项目目录。
- 回退时从上一标签恢复受影响文件并精确重发，创建恢复提交；AI 审计历史保留，数据库无需回滚。
