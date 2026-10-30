# 知识库双版本折叠展示 · 2026-10-30

用户已确认方案并要求“按照方案修正”。本轮只调整知识与策略列表展示。

## 范围与基线

- 执行目录：`D:/CRM/crm-knowledge-content`，继续沿用已有执行 checkout。原 `D:/CRM/crm` 的待处理修改保持原样。
- 修改前提交：`72b5387cefa08acf7a4565b6f920a09819702a85`，回滚标签：`release-20261030-130244`。
- 基线与发布核对日志：`tests/security/.results/knowledge-display-baseline.log`、`knowledge-display-release.log`；最终成功以脚本 exit 0 与最后一条 PASS 为准。
- 部署清单只有三个前端文件：`crm/js/modules/console/knowledge-governance.js`、`crm/js/modules/console/i18n.js`、`crm/css/console.css`。
- 没有数据库、视图、云函数、权限、路由或 AI 消费规则变更，无需 migration。没有访问 pr schema 或 pr_* 函数。

## 行为与设计

- 表格从九列改为八列。系统内容 / GPT 内容各占一列，各自依次展示“摘要”“查看原文”，默认无内容预览。
- 点击同一行任一侧的摘要，同时展开/收起两侧摘要；原文同理。两种展开状态独立，不影响其他记录，同 ID 的知识与策略也互不影响。
- 沿用已批准的 Console 工作台视觉、字体（PingFang SC / Segoe UI / Microsoft YaHei 等现有字体栈）、白底 `#ffffff`、墨色 `#2e333b`、灰线 `#e7e9ee`、品牌红 `#d31145`，不新增字体或 UI 框架。两套内容等宽，文字区域最大高度 220px，超长内容内部滚动。
- 系统完整原文/摘要已包含在列表返回值中。存在 GPT 预览的当前记录，在首次展开时通过 `assistant.knowledgeLibrary/content/get` 读取完整内容；同一请求合并，按表/ID/更新时间/内容版本/生命周期缓存。换版本后清除缓存并恢复折叠；离开页面后缓存随页面实例释放。
- 所有字段按自身内容显示；未填写或已清空时明确提示，绝不使用另一套原文/摘要补位。纯文本渲染，HTML 字符串不会作为标签执行。
- 加载中和加载失败有双语提示，失败可重试。排序重绘不会丢失进行中的请求结果。重新打开列表默认折叠。
- 历史 superseded 记录受现有只读快照接口限制，不调用该接口：系统内容仍完整可读，GPT 保留原有预览并注明“历史版本：仅提供预览，可能不完整”。不绕过服务端限制。
- 未形成知识条目的附件继续显示识别进度；没有对其调用不支持的内容版本接口。
- 内容编辑、清空、历史恢复、系统重新生成、人工 GPT 补录、整套引用、人工预览确认，以及有效性、删除、筛选、排序、分页保持原流程。

## 验证与交付门槛

- 修改前浏览器基线：原知识库两项用例通过，记录原九列与未折叠摘要布局。
- 针对性浏览器回归：`tests/pc22/knowledge-governance.browser.cjs`、`tests/knowledge-library/content-display.browser.cjs`、`tests/knowledge-library/content-versions.browser.cjs`。覆盖左右联动、原文/摘要独立、跨行隔离、懒加载去重、排序中异步返回、缓存失效、空值不混用、失败重试、历史预览、附件进度、无读操作写入、XSS、防绕过预览确认、相邻编辑路由及失败重试/删除。
- iPad：820×1180、1180×820，简体中文与英文，验证无页面/表格横向溢出、完整长文本可滚动；截图在 `tests/regression/.results/knowledge-display-*.png`。
- JS 语法检查与 `git diff --check`；CloudBase code-review 语义检查：沿用 ctx.api/callFn、无直连数据库或新认证逻辑、无密钥或环境变量输出、无 HTML 注入。
- 发布前重新采集 public 权限目录和身份审计，只读执行既有 WP01/WP04 SQL。运行 `npm run test:wp01` 与 `npm run check:release-gate`；真实登录/生产业务写入/真实模型调用未执行，仍须在门槛报告保留限制，不以源码一致冒充业务端到端验证。
- 本轮发布必须完成：通过门槛 → 精确上传三个文件 → Git 提交/推送/标签 → 完整三端源码核对。门槛、部署、Git 或核对失败即停止收尾，不宣称发布成功。

## 回滚

从 `release-20261030-130244` 恢复上述三个前端文件，执行同等回归、门槛与定向上传，通过新的提交/标签发布。没有数据库回滚或业务数据恢复操作；不强推、不覆盖原工作目录的用户修改。

## 本轮实际结果

- 基线完整通过：92 个前端产物、29 个云函数 / 231 个源码配置文件、58 份共享副本一致。审计目录 `D:/Temp/crm-cloud-audit-00b60ddeb9a646fab6542cd2e901cc3f`。
- 68 项知识库/会议准备/策略 Node 回归通过，4 项针对性浏览器回归通过；新增展示用例在最终文件状态下再次通过。中英文横竖屏及折叠状态截图已人工检查。
- public 目录权限 1184 项断言通过；78 项匿名权限探针通过；整站隔离回归 108 PASS、0 FAIL、5 历史 SKIP。WP01 完整执行 exit 0，发布门槛 PASS_WITH_LIMITATIONS，blockers 为空。真实登录、服务角色完整运行时、生产写入/AI、真机触控仍未验证。
- 计划发布标签 `release-20261030-134642`。定向上传及 Git 发布的最终结果以 `tests/security/.results/knowledge-display-release.log` 的最终 PASS 和此标签为准；不将计划标签视作成功凭证。
