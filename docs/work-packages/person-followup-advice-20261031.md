# 人物跟进建议并行双模型改造

## 范围与基线

- 基线：本地 `master` 所在干净工作区 `16195ea74f7b58004d29aa2722ea09751d63b3f1`；原工作区保留用户修改 `.agents/skills/pg-view-rebuild-check/SKILL.md`，不纳入本工作包。
- CloudBase 环境：`crm-d1gkae8ddc930d151`。改前只读核对了 `public` schema、迁移台账、页面资源和 29 个 CRM 云函数。云端页面与函数和该基线一致。
- GitHub `master` 首次查询遇到 TLS/SChannel 握手失败；改用 HTTP/1.1 后确认实时远端仍为基线提交。
- 影响范围：人物页 `#/ai/followup/:personId`、新任务包页 `#/ai/followup-tasks`、Console i18n 与样式、`assistant` 函数及其 Skill Registry、`public.person_followup_advice` 新表。
- GPT 由人工在 ChatGPT 运行 SKILL；CRM 不调用 GPT API、不存储或暴露服务角色凭据。

## 行为与数据

- 一行建议记录并行保存 CloudBase 系统侧和 GPT 侧两份内容，各含整体策略、产品/服务建议、知识来源与版本状态。GPT 侧可为空。
- 系统侧编辑递增版本，保留 GPT 内容并标记过期；编辑时可同步编辑 GPT、保留旧版或删除并重新入队。删除父记录采用软删除，GPT 内容随该记录一起隐藏。
- GPT 任务包只带有限、去标识化上下文及有效知识来源；支持按记录 ID 分批导出。导入先核对人物、建议、版本、来源与操作者，再提供预览；每条 GPT 写入都需人工确认。
- 新增服务端表仅在 `public`；服务角色独占读写。migration 与 rollback 配对，rollback 在已有记录时拒绝丢弃数据。
- 保留旧路由、旧双建议历史和既有 `ai_recommendations` 行为；旧历史从人物页“旧版双建议历史”折叠区查看。

## 回归记录

- JavaScript 语法：assistant 服务、入口、Skill Registry、Console 数据层、路由、视图、新模块通过 `node --check`。
- 定向知识库回归：64/64；AI Gateway：18/18；Skill Registry：11/11。
- 新页面 Chromium 回归：1/1，验证两个模型并排、两段内容、旧版状态、编辑与 GPT 删除、任务包、Preview/Confirm。
- 相邻回归：PC08 13/13、PC05 1/1、PC35 12/12；全站 regression 108 PASS、0 FAIL、5 SKIP。
- WP01 安全门：`PASS_WITH_LIMITATIONS`；新鲜 `public` 目录 1211 项无漂移，WP04 身份审计、匿名探针 79/79 及 WP02–WP06/PC34 检查通过。人工登录、线上业务写入、真实模型调用与移动端仍按安全门输出明确标记。
- CloudBase Code Review：确认新表启用并强制 RLS，仅授予 `service_role`；浏览器通过 assistant 服务端入口；导入确认绑定当前操作者、版本和短时预览；未触及存储或新增身份流程。
- migration 工具首次返回迁移台账未确认，但后台任务为成功；随后独立核验迁移台账出现版本 `20261031090000`，并核对 `public.person_followup_advice` 列、外键、空表状态、强制 RLS 与 `service_role` 策略。当前表为 0 行。迁移镜像路径 `C:\Users\victor\cloudbase\migrations\` 与仓库版本 SHA-256 一致。
- 已上传 `assistant` 云函数；静态托管仅上传 6 个 Console JS/CSS 文件。部署后 `sync-check.ps1 -CloudOnly` 通过：`admin.html` HTTP 200 且哈希一致，96 个可达页面资源一致，29 个 CRM 函数的 237 份源码/配置一致。

## 发布和恢复

- 迁移：应用 `20261031090000_person_followup_advice`；回滚文件仅在表为空时可移除该新增对象。
- 代码：只部署 `assistant` 云函数；静态托管只上传本工作包修改的 `/crm/js/modules/console/` 文件与 `/crm/css/console.css`，不上传整个项目。
- Git：`master` 已提交并推送 `b40482b4a2afb7d7148651dba54d64b7c04e7c7e`，标签 `release-20261031-1410` 已创建。使用干净工作区发布，未纳入原工作区保留的 Skill 文件修改。
- 恢复代码以本工作包发布标签为基准执行恢复提交并部署受影响产物。数据库 rollback 仅在确认没有建议记录和预览后执行；存在用户数据时停止评估，不丢弃数据。

## 发布后证据

数据库迁移、定向部署、CloudBase 资源核对及 GitHub 发布均已完成。`tools/release.ps1` 发布后复核通过：GitHub `master` 与标签指向该提交，线上 `admin.html`、96 个可达资源及 29 个函数的 237 份源码/配置与本地一致。
