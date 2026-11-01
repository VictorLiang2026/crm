# 跟进建议双模型流程修正

## 改造内容

- 移除系统建议新增表单中的人工标题与关注点输入，CloudBase AI 生成标题、整体策略、产品与服务建议。
- 每个来源显示独立标题和两段内容；CloudBase 与 GPT 各自提供编辑/删除操作。
- 删除 GPT 内容仅清空 GPT 侧并回到 pending；删除系统侧按现有软删除语义隐藏整条配对记录。
- GPT SKILL 尚未开发。人物页不再提供 GPT 任务包导入入口；旧任务路由与服务端操作保留，直达旧路由只显示 SKILL 未接入提示。
- 新增 `system_title` / `gpt_title` 兼容字段；`title` 仍与系统标题同步。迁移与 rollback 已分别写入仓库及 `C:\Users\victor\cloudbase\migrations\`。

## 验证

- `node --check`：assistant 服务、Skill Registry、跟进建议模块、i18n 和相关回归文件通过。
- 跟进建议服务端用例 3/3、隔离浏览器/iPad 用例 1/1、AI Skills 11/11、AI Gateway 18/18、PC08 13/13 通过。
- 知识库完整套件以串行模式运行：68/68 通过。PDF 分卷测试期望已同步为线上实际 30 页分卷；本轮未改 PDF 上传业务代码。
- WP04 只读身份审计与隔离夹具通过；保留既有 3 条待人工核对例外。WP01 门禁通过：目录 1,239 项、匿名只读探针 81/81、综合隔离回归 108 通过 / 0 失败 / 5 跳过。
- WP01 状态为 `PASS_WITH_LIMITATIONS`：真实登录、service-role 写入、线上业务写入/AI 生成和移动端验收未执行；未使用真实 Person 触发 AI 或产生业务写入。
- `public.person_followup_advice` migration `20261101090000` 已在线应用；schema 已含新字段，迁移与 rollback 均在仓库和 `C:\Users\victor\cloudbase\migrations\` 镜像。
- CloudBase `assistant` 部署成功。无登录、无写入的线上探测调用 `assistant`，得到预期 `UNAUTHORIZED`。
- 仅上传 `followup-advice.js`、`i18n.js`、`console.css` 三个明确静态资源。部署后核对：96 个页面资源以及 30 个云函数、243 个源码/配置文件与 CloudBase 一致。

## 发布状态

业务部署和 GitHub 发布已完成；发布后核对 GitHub、CloudBase 与本地基线一致。
