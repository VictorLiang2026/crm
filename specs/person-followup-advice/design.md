# 人物跟进建议技术设计

状态：用户已确认；实现中。

## 数据模型与兼容

- 继续使用单条 `public.person_followup_advice` 配对记录，不拆成两条互相孤立的数据。
- 增加 `system_title` 与 `gpt_title`，系统标题写入时同步旧 `title` 字段。既有记录迁移时 `system_title = title`；新建时先使用短暂占位值，模型成功后替换为 AI 生成标题。
- GPT 标题为空表示 GPT SKILL 尚未写入。现有 GPT 内容字段、状态、来源、版本和预览字段保留。
- 新迁移提供 rollback；rollback 若检测到系统标题和兼容标题分离或 GPT 标题已写入则停止，避免丢弃内容。

## 服务流程

1. Console 调用现有 `assistant` 入口和 `callFn`；浏览器只发送 personId 与请求幂等 ID。
2. `assistant` 读取人物资料、近期互动和知识条目，调用 CloudBase AI Gateway。模型仍由 CloudBase 配置选择。
3. AI 输出标题、整体策略和产品/服务建议。后两段沿用已登记 Skill 输出校验与知识来源白名单过滤。
4. lane 编辑接口只接收 `system` 或 `gpt` 一侧，并以 systemVersion + updatedAt 做乐观并发检查。系统编辑递增版本，GPT 内容标记为旧版本；GPT 编辑只更新 GPT 侧。
5. GPT lane 删除清空 GPT 标题/内容/来源及预览，设为 pending；系统 lane 删除继续走配对记录软删除。
6. GPT 任务页保留 URL 与后端操作以兼容，但界面显示“SKILL 尚未接入”，不提供当前手工任务包导入入口。

## 页面

- 人物页保留 `#/ai/followup/:personId`；一键触发 CloudBase AI 生成。
- 列表每条记录仍并排显示 CloudBase 与 GPT 两栏，每栏显示独立标题、两个内容区、状态和独立编辑/删除操作。
- GPT 为空时显示 SKILL 尚未接入空态；系统生成完成后允许编辑或删除。
- 双语文本通过 Console i18n 字典读取；布局只在现有 iPad 双栏设计内调整。

## 安全与验证

- SQL 限定 `public`；不涉及 `pr` schema 或 `pr_*` 函数。
- 现有 service_role / RLS、`callFn`、会话和软删除语义保持不变。
- 验证 AI Gateway Skill contract、知识库 CRUD、lane 级并发更新、GPT 删除重置、双语页面、旧路由及相邻人物模块。
- 不使用真实客户做写入型回归；浏览器测试使用合成 Person/advice。
