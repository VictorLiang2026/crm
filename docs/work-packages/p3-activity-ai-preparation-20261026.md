# P3d：活动 AI 筹备建议归入 Console Gateway

日期：2026-10-26。基线 `ae4f6b39899afca77dd919bf610043dc2970766a`，回退标签 `release-20261026-233928`。

## 范围与兼容

- Console 活动详情的筹备任务区增加“生成筹备建议”和“拆解建议任务”。结果含摘要、任务清单、邀约和风险，并显示 AI 结果编号。AI 只给建议；操作人员逐项核对后使用原任务编辑器人工新增，不自动修改活动、任务或参与者。
- `ai_activity.prepareV2` 验证真实登录、活动 ID 和状态，读取有界的 `public` 活动/参与者/嘉宾/任务上下文，复用 `activity_prepare` Skill 和 AI Gateway 审计。模型由 CloudBase 配置选择；不新建数据库对象。
- 旧 `prepare` / `decompose` 和其它旧活动 AI action、`admin.html` 保留兼容；嘉宾与主题推荐、参与者建议、经验总结等未在本包迁移。
- 所有新前端文本有中英文；仅按 iPad 验收。

## 验证与回退

- 模拟服务端验证登录、范围、Gateway 请求、无业务写入；浏览器验证双语及人工录入说明；Context Engine 和活动 CRUD 回归通过。完整 WP01 结果、生产函数调用及云端文件核对见发布输出。
- 仅部署 `ai_activity`、`crm/js/modules/console/activity-preparation.js`、`data.js`、`i18n.js`、`pages/activities.js`。从上一标签恢复这些文件并重新部署/创建恢复提交；数据库无需回滚。真实 AI 调用和生产写入不会用真实客户数据试验。
