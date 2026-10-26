# 设计

在活动详情“筹备任务”下增加小型建议卡。前端模块 `activity-preparation.js` 只调用 `ai_activity.prepareV2` 并展示结构化结果。无“采纳即写入”按钮；人工复制需要的项目到现有新增任务表单。

服务端新 `activity-prepare-v2.js` 先验证真实登录与活动状态，再由 Context Engine 构造带 `public` 来源的有界上下文，调用 `activity_prepare` Skill。AI Gateway 负责审计与配置模型。返回 `business_data_written:false` 和结果 ID；不调用业务表写入口。

`_shared/context-engine.js` 与 `ai_activity/context-engine.js` 同步；`ai_activity` 是本包唯一待部署云函数。没有数据库迁移。
