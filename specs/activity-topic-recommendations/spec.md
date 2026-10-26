# P3g 活动主题推荐

- Console 活动详情“嘉宾与主题”可从 `public.activity_topics` 中的在用、未选入本场主题生成 AI 建议；仅适用于筹备中的活动。
- 服务端验证真实登录、活动状态与来源 ID；候选池至多 20 个，模型只能返回池内 ID，重复、已选和伪造 ID 被过滤。
- 建议为只读。点击“勾选此主题”只修改当前页面的本地选择，操作人员检查后使用原“保存主题”流程写入原活动 ID。AI 不直接写活动、主题或参与者。
- 模型通过 AI Gateway/CloudBase 配置选择；中文和英文文本均从 Console i18n 字典读取。
- 旧 `admin.html` 与 `ai_activity.recommendTopics` 暂留作兼容，真实账号验收后再单独退出。
