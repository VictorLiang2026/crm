# iPhone 人物与行动布局调整发布记录

日期：2026-11-13（Asia/Shanghai）  
基线：`f973fb8`（`fix: extend knowledge summary gateway timeout`，最新 `master`）
目标环境：`crm-d1gkae8ddc930d151`

## 范围与影响

- 仅 iPhone UA 下启用本次 Console 样式；iPad、桌面浏览器及其他设备保持原布局。
- “优先行动”保留完整姓名和行动内容，将优先级徽标与既有编辑、完成、撤销按钮排成两行；隐藏彩色姓氏头像。
- “主动经营候选”隐藏彩色姓氏头像并保留完整姓名。
- “人物”页 iPhone 布局中搜索与筛选同排，导入/回收站/新建按钮纵向排列，人物视图标签同排；“全部人物/客户经营视图”在 iPhone 上显示为“全部/客户”，英文为“All/Clients”，完整名称保留在 title 提示中。
- 后续依用户确认的修正要求，“从资料导入人物、回收站、新建人物”三个操作按钮改为 iPhone 同一行显示；320 CSS px 宽度下标签完整不裁切。搜索/筛选和人物视图行保持不变。
- 不改变接口、数据、权限、数据库或按钮动作。静态模块仅涉及 `crm/css/console.css`、Console shell、today、people 和 i18n；同步既有测试的 Console 路由打开方式以稳定浏览器回归。
- 初始基线核对发现线上知识摘要超时为 120000ms、当时 master 源码为 60000ms。用户授权同步后，GitHub `master` 前进到 `f973fb8`，已将该行、对应知识库回归测试和发布记录提交；本轮快进纳入最新基线，不重复修改或部署该函数。

## 验证

- JS 语法及 `git diff --check`：通过。
- 定向浏览器回归（人物页、工作项、主动经营）：7 项通过。
- 后续人物页浏览器专项回归：6 项通过；新增 iPhone UA、320 CSS px 视口断言，确认三个按钮顺序、同排显示、文字不裁切且不超出工具栏。
- Chromium iPhone/iPad UA 布局核对：iPhone 布局及姓名/入口/视图行为通过；iPad UA 未启用 iPhone 专属样式。
- 知识库回归：111 项通过。
- WP04 身份审计：覆盖 customers 785/785、participants 6/6、recruits 573/573、speakers 6/6，异常 0。
- PC34 service-role 只读运行时回归：通过；WP04 快照为 `public` 对象读取，不写业务数据。
- WP01 发布门禁：`PASS_WITH_LIMITATIONS`，无阻断；公开目录快照 1,547 项检查通过，匿名只读探针 106/106 通过，隔离回归 102 项通过、5 项历史预设跳过。名单首页事实、WP04 身份审计、WP05、WP06、PC34 与 guard checks 均通过。
- WP01 明确未验证项：真实账号登录（`MANUAL_LOGIN`）、生产 service-role 运行时和写操作、线上 CRUD/AI/外发，以及真机移动端验收。本轮没有访问或修改真实业务记录；iPhone 布局用 Chromium UA/视口核对不替代真机验收。

## 部署与回滚

- 仅上传本记录列出的 5 个静态文件到既有 `/crm/` 托管路径；不部署云函数，不更改数据库。
- 回滚时恢复基线标签中的上述静态文件并重新上传；assistant 函数不需回滚，因为本轮不部署它，生产与最新 master 均为 120000ms 配置。

## 部署后核对

- CloudBase `manageHosting` 上传成功：仅 5 个指定静态文件，`failedFiles` 为空；线上地址：[CRM Admin](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。
- `tools/sync-check.ps1 -CloudOnly`：主页面 HTTP 200 且 SHA-256 一致；103 个可达页面/模块/样式与云端一致；30 个函数的 336 个源码/配置文件与云端一致（含 assistant）。共享模块 60 份副本一致。
- 线上 `admin.html` 未改变；没有部署云函数或数据库变更。CloudBase 上传响应确认 5/5 成功。
- GitHub `master` 提交与标签 `release-20261113-213524` 由 `tools/release.ps1` 执行并在终态同步检查中核验；提交号与本记录一同在该流程输出中留存。

## 后续 iPhone 按钮排列修正

- 用户确认将导入、回收站、新建人物三个操作按钮改为同一行；修改仅限 iPhone UA 下的 Console 人物工具栏 CSS，并增加对应浏览器断言。iPad 和桌面样式未改。
- 回退本次后续修正时，从基线标签 `release-20261113-213524` 恢复 `crm/css/console.css`，仅重新上传该样式文件；不涉及数据或云函数。
- 人物页专项浏览器测试：6/6 通过；WP01 门禁：`PASS_WITH_LIMITATIONS`、无阻断。隔离回归 102 项通过、5 项历史预设跳过；匿名探针 106/106 通过。WP01 保留真实登录、生产写入/service-role 与真机验收的既有未验证项。
- CloudBase `manageHosting` 上传修正后的 `crm/css/console.css` 成功（1/1，无失败）；其线上 SHA-256 已与本地一致，主页面哈希未变。
- 后续完整发布核对发现线上 `knowledge-document.js` 含有 GitHub `master` 尚无的 `kg-document-summary-editor` class（对象最后修改时间 `2026-11-13 14:08:16 UTC`）。用户授权只同步该 class；本地源码及知识库浏览器断言已对齐，业务请求和保存行为未变，未上传该文件（线上已有该内容），未改云函数或数据库。
- 知识库完整回归：111/111 通过；文档目录浏览器测试：1/1 通过；人物页专项测试：6/6 通过。最终 WP01 复跑：`PASS_WITH_LIMITATIONS`，隔离回归 102 项通过、5 项历史预设跳过，匿名探针 106/106 通过；`check:release-gate` 无阻断。
- 已查明回退基线：GitHub `master` 新提交 `5a0c43d`（22:22:31 +08:00）包含新版知识库编辑器 class，但其 `console.css` 仍是按钮纵向排列；托管对象更新时间为 14:23:22 UTC，与该提交发布时段吻合。把 `master` 快进到该已发布基线，再只调整 iPhone 三列按钮布局，保留提交中的 iPad 知识库样式。
- CloudBase `manageHosting` 仅上传 `crm/css/console.css`（1/1 成功）。对象 110,326 字节，ETag `71fcfb9662adde8b01623bd915023267`；带缓存绕过参数的 CDN SHA-256 `b44b3c7305755564f696818f637649f9c6398d7081255c1a350cdd742bdcf05f` 与本地一致，三列规则存在。`tests/wp01/static.cjs` 通过：103 个可达页面/模块/样式与云端一致。
- 完整 CloudBase `sync-check.ps1 -CloudOnly` 通过：`admin.html` 哈希一致，30 个函数的 336 份源码/配置与线上一致，60 份共享模块副本一致。没有部署云函数或数据库变更。
- 最终回归：人物页 6/6、知识库 111/111；WP01 `PASS_WITH_LIMITATIONS`（隔离回归 102 项通过、5 项历史预设跳过、匿名探针 106/106），发布门禁无阻断。真实登录、service-role 运行时、生产写入与真机验收保留为未验证项。
- 发布提交、标签及发布后的三端核验按 `tools/release.ps1` 输出记录；本轮只部署前端 CSS，没有业务数据操作。
