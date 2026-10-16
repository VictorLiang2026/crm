# PC22 设计

## 界面设计规格

1. **目的：** 在 Console 的“更多 / 知识与策略”中，让 CRM 用户维护 Evidence、Case、Story 与 Playbook，并查看来源、核验状态、有效期、置信度和适用场景。
2. **视觉方向：** 工业 / 工作台，适配内部审核操作和较高信息密度；沿用 Console 既有导航与控件。
3. **颜色：** 使用现有品牌变量：红 `#D31145` 表示主要操作，墨 `#2E333B` / `#565E6B` 表示正文层级，翠 `#1B8A5E` 表示已核验，金 `#A87A1E` 表示待审核，底色 `#F5F5F7`、卡片 `#FFFFFF`。品牌色是对通用 UI 技能禁色项的窄范围覆盖。
4. **字体：** 沿用现有 `-apple-system, PingFang SC, Segoe UI, Microsoft YaHei, sans-serif` 字体栈；作为现存品牌系统的窄范围覆盖，不新增字体依赖。
5. **布局：** iPad 优先；使用左侧筛选/条目列表与右侧详情/编辑内容的工作台分栏。iPad 窄幅或竖屏切为同页列表/详情切换，不设计手机专用页面。详情将来源与治理元数据分组显示，引用预览与修订历史保持独立区域。

## 技术边界

- UI：新增 `crm/js/modules/console/knowledge-governance.js`，在 More 的知识与策略分组增加新入口，旧版入口仍保留；词条全部位于 Console `i18n.js`。
- 服务端写入：新增受控 `assistant` action `knowledgeGovernance`。CloudBase 身份由现有 `getIdentity()` 验证，数据库请求由服务端 API Key 走 `public`。浏览器只传领域字段、目标 ID 和乐观锁版本，不传作者/审核 UID、SQL、任意表名或身份声明。
- 服务端读取：在 `person_360.getMeetingPrepContext` 的现有只读边界中读取已审核、有效的 Playbook 与 KnowledgeItem 引用，匹配/校验失败时保持旧的 “unavailable / no reliable evidence” 结果。
- Skill：沿用当前模型 Gateway 与响应字段。会前准备添加有效 Playbook 内容到已有 `relevant_playbook` context；对话策略将已有可靠上下文与经过核验的 Playbook/Evidence 合并，返回的 evidence 引用必须来自服务端构建的可靠集合。保持既有人工审核提示和 `businessDataWritten: false`。
- 类型语义：`knowledge_items.item_type` 的 Evidence、Case、Story 分开校验。只有 Evidence 可以进入 `reliable_evidence`；Case/Story 用于来源预览，不能冒充事实证据。

## 最小数据库扩展

`public.knowledge_items` 与 `public.playbooks` 增加：`lifecycle_status`（draft / verified / superseded / invalidated）、`created_by`、`verified_by`、`supersedes_id`、`version_no`、`updated_at`。Playbook 再增加 `source`、`confidence`、`valid_from`、`valid_to`。KnowledgeItem 沿用既有 `verified/source/valid_from/valid_to/confidence` 并确保审核状态与 `verified` 同步。

增加服务端专用 `public.crm_knowledge_review_v1(...)` RPC，在一个事务中检查目标记录状态与预期版本、来源/有效期、Evidence 最低置信度和 Playbook 引用类型/有效性，再发布新版本并将前序版本标记为 superseded，或将目标标记为 invalidated。只授权 `service_role` 执行。普通 authenticated/anon 的表权限保持拒绝。

修订采用追加版本：编辑只能修改 draft；已审核版本不能原位修改。AI 上下文快照继续保存本次输入内容和来源 ID，不回写旧快照。回滚 SQL 将新增治理元数据先归档到原有 `knowledge_items.metadata` / `playbooks` 可用字段，再撤销新 RPC、约束和列；不删除任何业务内容。

## 验证策略

- 离线单测：内容边界、来源/日期/置信度、版本链、引用类型、失效/过期、同名与并发乐观锁、未授权入口。
- 回归：`meeting_prep`、`conversation_playbook`、Person 360 context、AI 历史读取、More / Legacy 链接和 i18n。
- 数据库：迁移前后结构、约束、RLS、service_role-only RPC 权限；SQL 事务测试审核与回滚分支。
- 生产样本：通过普通界面确认，使用现有虚构人物创建一条已核验 Evidence、一条未核验 Evidence 和一条匹配 Playbook；核验自动派生标记、来源 ID 与可见提醒。不得增加初始 seed。
- 浏览器：iPad 断点检查 More 入口、列表、草稿、审核预览、失效与修订历史；真实登录未执行则明确记为未验证。
