# 跟进建议整行操作与 GPT 空记录补充

日期：2026-11-03

## 改动范围

- 跟进建议列表将 CloudBase AI 与 GPT 两栏作为同一条记录，提供整行“编辑”“删除”。编辑一次保存两栏，支持保留、编辑或清空已有 GPT 内容；GPT 为空时只提示后续由 SKILL 补充，不开放人工创建 GPT 内容。整行删除沿用记录软删除。
- GPT 任务包只选择系统建议已生成且 GPT 策略、产品建议均为空的记录。预览和确认阶段都核验 GPT 栏位仍为空，防止覆盖并发生成的内容。已有 GPT 内容若因系统版本变化而过期，保留并标记过期；人工清空后才重新进入任务包。
- 将 CloudBase 当前线上 `knowledge-content.js` 变更原样纳入版本库，保留其线上已存在的行为：样式标记、从 GPT 摘要选择原文摘要、移除历史恢复入口及“同时重新生成原文和摘要”选项。本轮没有进一步修改这些行为。
- 将 CloudBase 当前线上 `knowledge-governance.js` 的“知识条目编辑”标签差异原样纳入版本库，并为新增的 `basic_info` 标签补齐简体中文和英文翻译。
- 将 CloudBase 当前线上 `knowledge-pages.js` 变更原样纳入版本库，保留线上知识编辑行为及托管内容通过独立内容面板编辑的入口。
- 将线上 `person_360/knowledge-content.js` 中优先读取知识条目 `metadata.review_at`、缺省时回退到来源 `review_at` 的可用性判断原样纳入版本库；本轮没有部署该函数，因为这份源码已与线上一致。

## 影响与兼容

- 页面：人物跟进建议模块；接口：`assistant` 的 `adviceUpdate`、`adviceDelete`、`gptTaskPackage`、`gptImportPreview`、`gptImportConfirm`。
- 既有 lane 级更新接口继续保留，旧客户端仍可使用。没有数据库 schema、权限、模型配置变更。
- 部署范围：`assistant` 云函数；`/crm/js/modules/console/followup-advice.js`、`/crm/js/modules/console/i18n.js`、`/crm/css/console.css`；以及用于记录既有线上版本的 `/crm/js/modules/console/knowledge-content.js`、`crm/js/modules/console/knowledge-governance.js` 和 `/crm/js/modules/console/knowledge-pages.js`。`i18n.js` 同步添加线上标签所需的双语词条。`person_360/knowledge-content.js` 只纳入源码，不重新部署。

## 验证

- 知识库回归（串行）：76 项通过。
- 跟进建议服务及浏览器回归：11 项通过。
- 知识库内容显示及编辑器浏览器回归：2 项通过（含生产标签中英文显示检查）。
- 知识库 PDF 编辑器浏览器回归：1 项通过。
- WP01 发布门禁：`PASS_WITH_LIMITATIONS`，匿名探针 81/81 通过；登录、生产写入/真实 AI、真实移动端仍未验证。
- 线上安全调用未登录的 `assistant` 请求，返回 `UNAUTHORIZED`，未触发业务写入。

## 回滚

- 不涉及数据库迁移或回滚。
- 回滚跟进建议功能时，恢复对应 JS/CSS/i18n 及 `assistant` 函数到本次之前版本；保留已纳入版本库的线上知识库文件行为，避免回滚时覆盖既有线上改动。
