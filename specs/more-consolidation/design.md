# 更多功能精简整合：实施设计

## 基线

初始源码 1e46c83ade76d500c24a8b607dd2a9d5d616ec05，回滚标签 release-20261023-003115。
生产环境 crm-d1gkae8ddc930d151。执行副本 D:\\CRM\\crm-more-consolidation。
原工作区 PC36 验收文档存在独立未提交修改，保留原样，不纳入本轮提交。
独立副本初始本地克隆落在旧提交 b792cb2；已从 GitHub master 快进至上述基线，未部署旧副本。

## 页面归属

| 能力 | 归属 | 兼容策略 |
| --- | --- | --- |
| 客户资料、跟进、保障、礼品、附件、OCR | Person 相关页签 | 原客户 URL 保留；不自动创建客户角色 |
| 嘉宾、主题 | 活动资源目录 | 复用既有表单与服务；未覆盖旧 AI 推荐保留 |
| 招募目标 | 招募工作区 | 原目标基准编辑等高级功能保留链接 |
| AI 历史 | 现有 AI experience + Person 历史 | 旧建议独立来源只读，不假装 ai_result |
| 知识与话术 | 现有 knowledge-governance | Evidence/Case/Story/Playbook 数据类型不变 |
| 工作量、漏斗 | 轻量经营分析入口 | 复用事实口径，标明 Person-only 覆盖缺口 |
| 回收站 | 统一入口、三个对象子页 | 所有旧 URL 与旧批量恢复保留 |
| 更多 | 知识、经营分析、设置、回收站 + 折叠兼容 | 等价验收后收拢；手机原依赖入口保留 |

## 实现边界

新 UI 放 crm/js/modules/console，复用 core/components/css 与 t()。路由显式区分 native/legacy，不通过任意 key 特例推断。M01 只修匹配参数转发和旧客户跳转。

文件导入新增草稿路径必须复用既有 ai_parse/OCR 服务边界：原件归属、允许类型与大小、幂等和失败恢复先在 M08 定义并测试，再上 M09 页面。应用候选仍走 PC14 预览确认，不改变 Legacy Quick Capture 或 PC37。

旧机会 M10 必须使用独立、范围受限的服务适配器；保留 PC27 Person-only 防线。M11 只接已验证执行器，不能客户端直接放开更新。

AI 历史优先来源分栏和服务端分页，避免把截断列表当全部结果。保留 CloudBase 事件元数据投影、actor 作用域、反馈幂等及可读结果回执。

## 界面设计约定

目的：让个人保险营销工作在人物、活动、招募工作区完成，降低重复入口与跳转成本。风格沿用当前业务工作台；不引入新的视觉主题。

配色复用 Console token：主行动 #d31145、正文 #2e333b、背景 #f5f5f7、机会 #a87a1e、已确认 #1b8a5e。字体复用 -apple-system / PingFang SC / Segoe UI / Microsoft YaHei；这是已批准项目设计系统，对技能的通用字体偏好作有限例外。

布局复用 pageHead、card、tile-grid、sheet 与既有间距，按工作区主操作、状态/证据、低频兼容顺序呈现。iPad 820×1180 与 1180×820 验证；不改全局字体、框架或手机断点。所有新文本经 i18n t()，英文长标题允许缩写并提供 title。

## 发布验证

每包按真实影响跑专项和相邻回归，再通过 WP01 安全门槛。仅上传变更静态文件和受影响函数。Git 原子推送提交/发布标签，逐包三端源码核对；源码一致与真实业务验证分别记录。

UI/函数回退用上一已核对版本的精确文件及恢复提交；数据迁移单独评估 rollback，不回滚用户业务数据。M18 汇总四条端到端链及实际未验证项，M19 只给清退建议。

## 已落地结构（2026-10-24）

- 导航：#/analytics、#/activity-report、#/activity-resources、#/recycle新增整合入口；所有原typed报表、人物页签、旧admin路由继续有效。More使用显式native/legacy类型，不以字典key猜测地址。
- 文件：person_360的file-import-service负责原件/任务身份与归属；ai_parse新模式只生成草稿。public.crm_file_import_jobs和crm_file_import_v1负责同事务保存、请求幂等、解析租约、结果回执；PC14仍负责审核应用/撤销。单文件4MiB、队列10项；JPEG/PNG/WebP、UTF-8 TXT/CSV可解析，PDF/DOCX仅保留原件，不宣称支持内容解析。
- 机会：person_360/legacy-opportunity-service和public.crm_legacy_opportunity_commands、crm_legacy_opportunity_v1仅覆盖已有customer-linked机会的受限编辑/关闭。PC27 Person-only保护保留；未扩大自然语言命令范围。
- AI历史：assistant现有aiExperience/personAIHistory扩展可选filters；不带filters保留旧响应。新Runtime以任务分页，旧ai_recommendations独立只读；不把旧ID送入新反馈链。日期字段、时间窗、相关记录上限和非筛选全局指标分别说明。
- 知识：保留Evidence/Case/Story/Playbook，审核状态与北京时间有效期分别显示；异议原因仅是假设。各类最多加载200条，前端筛选只针对已加载内容。
- 统计：activity_reports和public.v_funnel_stats事实计算不变；报表明细上限300，旧机会漏斗不含Person-only，当前阶段分布不宣称历史转化率。AI解读点击后调用既有funnel_insight服务，失败不丢事实。

本轮只新增上述2表/2例程，没有新增云函数或修改共享运行时。数据迁移均为加法且配rollback；有记录时rollback保护阻止误删任务/命令历史。源码回退和数据回滚必须分开评估。
