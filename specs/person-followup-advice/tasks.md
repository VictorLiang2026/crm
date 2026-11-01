# 人物跟进建议改造任务

状态：代码改造完成；发布被现有 CloudBase OAuth/MCP 工作区冲突阻断。

- [x] 1. 复核当前 UI、服务端生成/编辑/删除和线上 `public` 表结构；确认表无业务行。
  - _Requirement: 全部_
- [x] 2. 收敛验收规则：系统 AI 一键生成；GPT SKILL 尚未接入；双侧标题和编辑/删除彼此独立。
  - _Requirement: 1–8_
- [x] 3. 准备标题增量 migration/rollback，并保留旧 title 字段和软删除流程。
  - _Requirement: 2, 3, 7_
- [x] 4. 更新 CloudBase Skill 输入契约；生成时不要求人工标题/关注点；新增 lane 独立更新分支，兼容旧 paired-update 接口。
  - _Requirement: 2–5_
- [x] 5. 改 Console 人物建议页为一键生成、两栏各自编辑/删除、GPT SKILL 空态；旧任务包路由不再显示手工导入 UI。
  - _Requirement: 1–8_
- [ ] 6. 完成回归与发布门槛。
  - 改动文件语法检查通过；定向服务/浏览器 4/4、AI skills 11/11、AI Gateway 18/18、PC08 13/13 通过。
  - 知识库全套 59/65；6 项 PDF 测试在隔离工作副本报 `INVALID_CONTENT` 或缺少嵌套 `@napi-rs/canvas`，与跟进建议修改无关。
  - People pages 4/5；剩余浏览器用例在打开 `/admin.html#/more` 时出现 `chrome-error://chromewebdata/` 超时。
  - WP01 发布门槛被线上 `crm_knowledge_mcp_clients`、`crm_knowledge_mcp_grants` 与两项 MCP routine 不在当前安全基线阻断；发现这些变更属于另一份未提交 OAuth/MCP 工作区。
  - 线上 `assistant` 与 OAuth/MCP 工作区代码逐文件一致；不得用本工作包基线覆盖该已部署功能。
  - _Requirement: 全部_
- [ ] 7. 部署明确文件并完成 GitHub 发布。
  - `20261101090000` migration 已应用并核对台账/字段，当前表仍为空。
  - assistant 与页面文件尚未部署，GitHub 尚未提交/推送/打标签；待 OAuth/MCP 工作区完成合并或发布授权后继续。
  - _Requirement: 全部_
