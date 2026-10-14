# PC03 More 分区与功能覆盖台账（增量）

日期：2026-10-15（Asia/Shanghai）
范围：仅 Console `#/more` 信息组织、双语标签、静态只读回归夹具与本台账。无数据库、云函数、权限或业务数据变更。

## 实施结果

- 保留原有 8 个 Console 主工作区/快速记录入口和主导航顺序。
- 新增“系统与账号、知识与策略、回收站、旧版兼容”四个分区。
- 原 17 个 Legacy 链接逐个保留原 hash 和 `admin.html` 目标，并加上双语 Legacy 状态；Person 回收站使用 Console 原生 `#/people-trash`，与客户和增员旧回收站分列。
- 账号退出仍可在 More 的“系统与账号”区执行；设置页仍保留相同退出入口。
- 删除 More 中的 WP 阶段排期卡片，将快速记录说明改为面向用户的行为描述；没有显示尚未实现的规划入口。
- 新增覆盖浏览器回归与静态 JS/CSS 行尾比较；静态页面 HTML 仍逐字节比较。

## 17 个 Legacy 入口及真实路由

“页面打开”状态只表示路由由当前 `admin.html` handler 加载，不代表页面内每个按钮都已实测或数据写入流程已验收。权限和写入语义均来自源码静态追踪；本包浏览器回归只用隔离夹具打开页面，未执行写入。

| More 分区 | 入口 | 原路由 | 实际目标/调用链 | Person 新模块覆盖与剩余边界 | 删除/恢复、统计口径 | 状态/证据 |
|---|---|---|---|---|---|---|
| 系统与账号 | 账号与应用维护 | `#/account` | `account-settings.js`：改密、CloudBase signOut、强制加载最新页面 | Console Settings 提供改密/退出；Legacy 强制刷新能力仍保留 | 无业务数据删除；无业务统计 | 本包隔离浏览器打开成功；不执行改密或退出 |
| 系统与账号 | 测试场景 | `#/test-scenario` | `test-scenario.js`；打开时调用 `assistant.testSamples(status)`，写入需 preview → 人工确认 → execute | 这是受控测试工具，不属于 Person 业务功能迁移 | 专用虚构样本；初始种子上限 10 行；后续触发数据另有派生计数 | 本包只验证页面打开/status 夹具，不预览或生成样本 |
| 知识与策略 | 经营漏斗 | `#/funnels` | `showFunnels()`；读取客户经营漏斗统计 | Opportunities 是 Person 化机会看板；Legacy funnel 仍按客户口径展示 | 汇总口径和筛选以 Legacy 页面实现为准；只读打开 | 本包隔离浏览器打开成功 |
| 知识与策略 | AI 建议历史 | `#/ai-suggestions` | `showAiSuggestions()` → `ai_recommendations.listAll` | Person AI 建议在 Person 360；历史建议库仍是旧模块 | 只读列表；按姓名/建议日期/建议跟进日期筛选，不在此入口生成建议 | 为隔离回归补只读空列表响应；本包不调用真实 AI |
| 知识与策略 | 保单检视 | `#/more/policy-review` | `renderLegacyPicker` → `customers.list` → `#/customer/{id}`，目标 tab 在当前路由映射中为 `products` | Person 360 有保险上下文读取；Legacy 保单操作尚未逐项确认 | 客户选择列表为只读；详情页动作未在本包执行 | 标签声称“保单检视”，实际 tab 映射为 `products`；登记为目标差异，本包不改已有行为 |
| 知识与策略 | 产品 | `#/more/products` | 选客户 → `#/customer/{id}` → `products` tab | Person 360 保险上下文提供聚合读取；产品维护仍保留 Legacy | 旧客户详情中的产品记录操作未在本包执行 | 本包隔离浏览器打开 picker 成功 |
| 知识与策略 | 伴手礼 | `#/more/gifts` | 选客户 → `#/customer/{id}` → `gifts` tab | Activities 新页当前未覆盖完整礼物维护 | 详情操作未在本包执行；统计口径未迁移 | 本包隔离浏览器打开 picker 成功 |
| 知识与策略 | 照片/OCR | `#/more/photos` | 选客户 → `#/customer/{id}` → `photos` tab；picker 可切换到 `#/more/ocr` | Person 360 有资料/保险上下文读取；OCR 工作流尚未整合 | 上传、识别、人工复核均未执行；原始统计口径保留 | 本包打开照片 picker；OCR 由同一入口的交叉链接保留 |
| 回收站 | Person 回收站 | `#/people-trash`（新增 More 快捷入口） | Console `renderPeopleTrash()` → `person_360.listPersonTrash`；恢复走 `restorePerson` | 新 Person 软删除/恢复入口 | Person 批次恢复与旧记录本体恢复有不同服务端语义；本包不执行恢复 | 隔离浏览器打开成功；服务端写入未验证 |
| 回收站 | 客户回收站 | `#/customers/trash` | `showCustomerTrash()`；旧客户回收站列表/恢复 | 仍由 Legacy 客户软删除模型承载 | 客户恢复独立于 Person/增员；详情语义未在本包执行 | 隔离浏览器读取虚构删除样本成功 |
| 回收站 | 增员回收站 | `#/recruit/trash` | `showRecruitTrash()`；候选人回收站列表/恢复 | 仍由 Legacy 招募软删除模型承载 | 候选人与其客户关联有独立恢复状态；详情语义未在本包执行 | 隔离浏览器读取虚构删除样本成功 |
| 旧版兼容 / 客户经营 | 传统客户列表 | `#/customers` | `showList()`；11 列客户契约与客户详情 | People 目录展示 9 列 Person 字段；不是 11 列客户业务契约替代品 | 客户来源字段、删除恢复和统计口径仍以 Legacy 为准 | 本包隔离浏览器打开成功；字段差异承接 PC04 |
| 旧版兼容 / 客户经营 | 传统跟进 | `#/more/followups` | 先读取客户列表；人工选择后进入详情 `followups` tab | Person 时间线可聚合 Legacy followups，但旧跟进编辑能力尚未全迁 | Legacy followup 的编辑/删除及统计口径需 PC05 对照 | 本包验证 picker 可打开；未选择真实客户或写入 |
| 旧版兼容 / 活动与内容 | 客户活动量 | `#/activity/customer` | `showCustomerActivity()` 客户经营活动报表 | Activities 已有活动/参与人只读上下文；报表未完整迁移 | 旧报表统计口径、日期边界、导出须由 PC21 对照 | 本包隔离浏览器打开成功 |
| 旧版兼容 / 活动与内容 | 增员活动量 | `#/activity/recruit` | `showRecruitActivity()` 组织发展报表 | Recruit 已有候选人和阶段进度；活动报表未完整迁移 | 旧招募活动量口径、日期边界、导出须由 PC21 对照 | 本包隔离浏览器打开成功 |
| 旧版兼容 / 活动与内容 | 嘉宾资源 | `#/speakers` | `showSpeakers()` 嘉宾资源管理 | Activity Speakers 有 Person 关联入口；遗留资料字段仍需逐项映射 | 旧嘉宾停用/删除与活动引用需 PC17 对照 | 本包隔离浏览器打开成功 |
| 旧版兼容 / 活动与内容 | 主题资源 | `#/topics` | `showTopics()` 活动主题管理 | Activities 详情能读取主题；完整主题维护尚未迁移 | 删除/停用及活动引用需 PC17 对照 | 本包隔离浏览器打开成功 |
| 旧版兼容 / 组织发展 | 招募目标 | `#/recruit/goals` | `showRecruitGoals()`；目标维护及进度汇总 | Recruit 目前展示目标进度；目标编辑仍使用 Legacy | 目标年度、组织口径与汇总需 PC21 对照 | 本包隔离浏览器打开成功 |

> 权限摘要：这些路由通过当前已登录会话进入 `admin.html`，后端 action 的具体授权仍由各既有 Cloud Function/SQL handler 执行。PC03 未更改权限，也未用浏览器夹具替代真实线上权限验证。

## PC03 回归与发布状态

回归覆盖计划：17 个原始 href 精确校验并逐项打开；主导航、Settings、Person/客户/增员回收站；浏览器前进/后退；中英标签；iPad 820×1180 与 1180×820 横竖屏水平溢出。

| 项目 | 结果 |
|---|---|
| 静态校验 CRLF/LF 比较单测 | 已通过 3 项；更改 JS 内容会失败，HTML 继续逐字节比较 |
| More 浏览器回归 | `npm run test:pc03`：17 个 Legacy href 全部精确匹配并逐项加载目标；Person recycle、Settings、7 项主导航、hash 前进/后退、中英标签、退出入口均核验；820×1180 与 1180×820 无横向溢出。测试只用隔离 Chromium 夹具，非真实 iPad Safari |
| 完整旧功能回归 | `npm test`：108 PASS / 0 FAIL / 5 SKIP；`npm run test:modular` PASS；PC03 专项及行尾比较：4 PASS / 0 FAIL。路由打开未执行业务写入 |
| CloudBase 静态发布 | PC03 的 `misc.js`、`i18n.js`、`console.css` 在本轮开始前已经上线；本轮未重复上传。`node tests/wp01/static.cjs` 通过，51 个引用页面/模块/样式在线与发布副本匹配 |
| 完整云端源码核对 / Git 发布 | 人物筛选 404 修复已部署 `person_360`，用户在生产页面确认筛选后列表成功加载，生产日志显示原筛选 RPC 404 后分页回退请求均为 HTTP 200。PC03 本身未改动云函数、数据库、权限或业务数据。全量 `sync-check.ps1 -CloudOnly` 通过：51 个前端资源、29 个 CRM 函数的 175 份源码/配置文件匹配；WP01 发布断言通过。本次发布包含 PC03 静态源文件、测试与台账，tag 为 `release-20261015-005645`。 |

## PC04 交接

PC04 先核对 Person People 目录与 Legacy 客户 11 列契约之间的字段映射、按钮动作、权限、回收站语义和统计口径。Person 9 列目录已上线，不表示它替代客户列表。保留 `#/customers` 及详情路由；任何字段归属变更需 migration/rollback 配对，且不得在本台账先行删除 Legacy 行为。保单检视路由与 `products` tab 的目标差异也应独立评估并经批准后再修。
