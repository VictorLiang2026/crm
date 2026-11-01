# 跟进建议双模型流程修正

## 改造内容

- 移除系统建议新增表单中的人工标题与关注点输入，CloudBase AI 生成标题、整体策略、产品与服务建议。
- 每个来源显示独立标题和两段内容；CloudBase 与 GPT 各自提供编辑/删除操作。
- 删除 GPT 内容仅清空 GPT 侧并回到 pending；删除系统侧按现有软删除语义隐藏整条配对记录。
- GPT SKILL 尚未开发。人物页不再提供 GPT 任务包导入入口；旧任务路由与服务端操作保留，直达旧路由只显示 SKILL 未接入提示。
- 新增 `system_title` / `gpt_title` 兼容字段；`title` 仍与系统标题同步。迁移与 rollback 已分别写入仓库及 `C:\Users\victor\cloudbase\migrations\`。

## 验证

- `node --check`：assistant 服务、Skill Registry、跟进建议模块、i18n、浏览器回归文件通过。
- 跟进建议服务端与隔离浏览器用例：4/4 通过；AI skills：11/11；AI Gateway：18/18；PC08：13/13。
- 知识库全套：59/65。6 项既有 PDF 覆盖在隔离副本遇到 worker `INVALID_CONTENT` 或缺少嵌套 `@napi-rs/canvas`；跟进建议服务/页面相关用例均通过。
- People pages：4/5。失败项是浏览器在打开 `/admin.html#/more` 时进入 `chrome-error://chromewebdata/`，与本次页面无关。
- WP01 安全门：阻断。实时 `public` 目录中出现 2 张 MCP 表和 2 个 MCP routine，尚未列入当前 `master` 安全基线。只读检索确认相应迁移和代码存在于另一份未提交 OAuth/MCP 工作区。
- 只读下载确认线上 `assistant` 与该 OAuth/MCP 工作区源码逐文件一致。直接部署本工作包 assistant 会覆盖该线上功能，因此尚未部署前后端、未提交/推送/打标签。
- `public.person_followup_advice` migration `20261101090000` 已应用，迁移详情与本地 SQL 一致；schema 已含新字段，表行数为 0。

## 后续发布条件

先将已部署 OAuth/MCP 工作区变为可发布的共享基线，或由用户授权本轮将该工作区改动一并纳入同一发布。完成后在不丢失该工作内容的前提下重新运行 WP01、部署 assistant 及本工作包的三个前端文件，再完成云端/GitHub 一致性核对。
