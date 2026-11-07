# admin.html 与 Console 功能消费者审计

日期：2026-11-07  
范围：只读审计 `admin.html`、`console.html`、Console 路由和页面、旧链接与现有浏览器测试。未修改业务代码、数据库、云函数或路由。

## 结论

Console 已拥有完整同类页面，不代表 admin 内同名实现的所有调用都能删除。当前可进入一次集中确认的安全候选为：账号维护、招募目标、客户/增员回收站、客户/增员活动统计、旧活动嘉宾/主题目录的入口和独立页面实现。实施前仍需保留 admin 旧 URL 的兼容跳转；相关代码若被其他 Legacy 页面直接调用，应先拆清入口与内部调用，不能连带删除。

本次没有足够证据支持删除 `admin.html` 中的人物/客户详情、机会、活动详情、漏斗、今日教练、AI 建议历史、快速记录、客户附件入口或其调用链。Console 与 Legacy 之间存在 ID 类型、写入能力或流程差异，列为保留项。

## 消费者矩阵

| 功能/旧入口 | Admin 消费者 | Console 所有者与证据 | 分类 | 建议 |
| --- | --- | --- | --- | --- |
| 人物目录 `#/people` | `admin.html` 分派至 `phase14-hubs.js::renderPeople`；提供 Person 搜索、角色、转客户/增员 | `console/pages/people.js` 提供目录、筛选、身份核对；`tests/console/people-pages.browser.cjs`、`person-customer-operations.browser.cjs`、`referrer-role.browser.cjs` | CONSOLE_OWNED（页面）；SHARED（Legacy 详情/身份桥接） | 删除 admin 重复人物目录 UI/读取逻辑；保留必要的旧 hash 跳转。保留客户/增员详情和身份桥接，不删除 `openPersonCommand` 或 Legacy 被引用部分，需做全局调用核查。 |
| 客户经营列表 `#/customers` | `legacy-customer-route.js` 仅提示并链接到人物目录 | Console People 目录承载角色筛选；现有测试检查 Legacy stub | CONSOLE_OWNED | 当前已是轻量兼容提示，无重复业务逻辑；保留即可，无需重复改造。 |
| 客户/人物详情 `#/customer/:id`、`#/person/:id` | `admin.html` 仍有客户业务字段、传统跟进和附件入口；Person 与 Customer ID 不相同 | `console/pages/person.js`、`care-materials.js`；覆盖 Person 主档与部分客户关联能力 | SHARED / UNKNOWN | 保留。不能把 Customer ID 直接当 Person ID 重定向；客户附件仍须按客户关联关系读取。先补齐逐项字段/写入/附件映射后再议。 |
| 招募目录与详情 `#/recruit`、`#/recruit/:id` | admin 仍有旧招募详情和相关业务操作 | `console/pages/recruit.js` 提供人物招募视图；PC19/PC20/PC31 覆盖主要新流程 | SHARED | 保留 Legacy 详情、内部链接和写入。人物角色视图可以由 Console 所有；不能据此删除不同 ID 的招募详情流程。 |
| 招募目标 `#/recruit/goals` | `admin.html::showRecruitGoals`，并有旧目标表单/历史实现；旧“更多”枢纽保留该链接 | Console 路由同 hash 对应 `renderRecruitGoals`，含目标编辑、历史、转化假设、反向测算草稿；PC21 覆盖统计报告，招募目录有入口 | CONSOLE_OWNED | 建议 admin 旧路由改为跳转 `console.html#/recruit/goals`，移除 `showRecruitGoals` 的重复 UI/业务读写。不要删目标数据 API/字段。 |
| 客户回收站 `#/customers/trash` | `showCustomerTrash` 与旧列表/恢复处理 | Console `pages/recycle.js` + `pages/people-trash.js`/客户回收页，PC35 覆盖恢复与回收站；测试确认 More 无重复旧链接 | CONSOLE_OWNED（页面）；共享恢复契约 | 建议旧 hash 跳转 Console 客户回收站，移除重复页面处理；保留服务端软删除/恢复语义和旧 hash 兼容。 |
| 增员回收站 `#/recruit/trash` | `showRecruitTrash` 与旧列表/恢复处理 | Console 回收站招募页；PC35 覆盖；旧链接 smoke 验证可打开 | CONSOLE_OWNED（页面）；共享恢复契约 | 建议旧 hash 跳转 Console 增员回收站，移除重复页面处理；不删除数据/API。 |
| 客户/增员活动统计 `#/activity/customer`、`#/activity/recruit` | `showCustomerActivity`、`showRecruitActivity` 及旧报表页面 | Console `activity-report.js` 支持客户/增员类型、日期范围；`tests/pc21/activity-report.browser.cjs` | CONSOLE_OWNED（报表 UI）；数据口径待回归 | 建议旧 hash 跳转至 Console 对应报表，并保留日期区间参数。发布前对比两端指标、空值和日期边界。 |
| 活动列表/详情 `#/activities`、`#/activity/:id` | admin 活动列表、详情、删除/参与者/资源等处理；多个 Legacy 页面内部调用 `showActivityDetail` | Console `pages/activities.js`、活动详情路由与 `activity-people.js` 覆盖活动、筹备、参与者、嘉宾/主题；PC16/PC21/PC31 | SHARED（Console 页面能力已广覆盖，但存在 Legacy 内部消费者） | 先保留。要迁移需逐项对齐活动字段、状态、参与者和资源写入，并隔离 admin 内部调用；本轮证据不足以安全删除整段实现。旧活动 hash 暂不改。 |
| 嘉宾/主题目录 `#/speakers`、`#/topics` | `showSpeakers`、`showTopics` 有目录与维护表单；并有来自活动详情的内部调用 | Console `activity-people.js` 有独立目录、嘉宾/主题维护、Person 关联；Console 活动详情也复用资源模块 | CONSOLE_OWNED（目录交互）；SHARED（活动详情内部调用） | 建议旧独立目录 hash 跳转 Console `#/activity-speakers` / `#/activity-topics`，删除重复目录渲染；仅在证明活动详情等 Legacy 调用已解除后，才删除共享 helper。 |
| 机会 `#/opportunities` | admin `phase14-hubs.js::renderOpportunities`；旧客户详情还负责旧客户机会操作 | Console `pages/opportunities.js` 有候选审查与 Person 机会；页面明确保留“旧客户机会仍在原详情操作”；PC15、PC31、`legacy-opportunity-maintenance.browser.cjs` | SHARED | 保留。旧客户机会仍依赖 admin 客户详情，不能因 Console 有机会页而删除该所有者/接口。仅未来确认旧客户机会已迁移后再审计。 |
| AI 总览/AI 搜索 `#/ai`、`#/ai/search` | admin 的 Phase14 AI 枢纽、`ai-crm-search.js` 搜索页 | Console AI 页面、AI 搜索与 Gateway 读取测试；但旧建议记录和 Quick Capture 仍有 Legacy 写入流程 | SHARED | 仅在确认 AI 搜索/总览所有链接与功能等价后移除重复展示；保留旧建议记录和 Legacy Quick Capture。PMC11 映射明确指出旧 AI 端点仍活跃。 |
| AI 建议历史 `#/ai-suggestions` | `showAiSuggestions` 可查看/处理旧建议；旧活动/客户页面含入口 | Console AI 历史目前不等同于建议记录管理；`phase14-hubs.js` More 保留旧建议入口 | LEGACY_ONLY | 保留；不是可清理死代码。不要据 Gateway 测试推定旧建议数据和写入已迁移。 |
| 今日/今日教练 `#/today` | `showTodayCoach`、旧仪表内容和跨页入口 | Console `pages/today.js` 包含今日工作区与待办；PC 测试覆盖新页面 | SHARED / UNKNOWN | 暂保留，逐块比对提醒规则、数据口径和操作目标后再拆。 |
| 漏斗 `#/funnels` | `showFunnels` 旧漏斗页面 | Console `analytics.js` 含经营分析与活动/增员报告入口，但尚未形成旧漏斗每项指标一一对应证据 | UNKNOWN | 保留；先建立指标/筛选/日期口径对照，不只凭相似标题跳转。 |
| 账号维护 `#/account` | `account-settings.js`：改密码、退出、强制加载最新版 | Console `pages/settings.js` 覆盖密码校验/修改、退出、强制刷新；`more-navigation.browser.cjs` 对 Console 设置页及 Legacy URL 做浏览器验证 | CONSOLE_OWNED | 建议旧入口跳转 Console `#/settings`，移除 `account-settings.js` 重复界面。回归登录态、密码失败/成功、退出和未保存输入提醒。 |
| More 中传统工具入口（跟进、保单检视、产品、礼品、照片、OCR） | admin 仍包含选客户后操作的旧页面 | Console Person 详情承载部分能力，但没有等价的所有旧全局选客入口；礼品按 Person ID、客户附件按 Customer 关联 | LEGACY_ONLY / SHARED | 保留旧入口与 ID 语义。不得把附件、礼品或 OCR 页面合并/删除，直至逐项证明 Console 已覆盖原选择、关联和写入路径。 |
| 快速记录 `#/quick-capture` 及 AI 旧流程 | admin Legacy 流程仍存在 | Console Quick Record 有人物候选确认的新流程；AGENTS 明确要求 Legacy Quick Capture 保持原流程，直到单独批准接入 | SHARED | 保留旧流程。本次不改变候选身份或写入边界。 |
| 人物导入、知识库、测试场景、统计 | admin 仍有历史工具或链接 | Console 已有导入、知识、测试场景和分析对应页及相关测试 | CONSOLE_OWNED / UNKNOWN | Console 页面保留为新所有者；未逐项核清 admin 实际入口/后台调用与文件服务前，不删除 Legacy 实现。 |

## 推荐的一次性清理清单

以下是建议交给后续实现包、并在编码前集中确认的范围。确认仅覆盖前端重复 UI/处理器和兼容跳转，不包含任何数据库、Cloud Function、API 合约或 Route 删除/改名。

1. **账号维护**：`admin.html` 的 `#/account` 改为跳转 `/crm/console.html#/settings`；删除对 `crm/js/modules/account-settings.js` 的 admin 加载路径。若文件还有其他消费者，保留文件并移除 admin 专用调用即可。
2. **招募目标**：保留 hash `#/recruit/goals`，由 admin 侧兼容跳转到 Console 同 hash；删除 `showRecruitGoals()` 及仅供其使用的旧 UI 状态和样式。保留招募目标 API 与数据字段。
3. **回收站**：`#/customers/trash` 与 `#/recruit/trash` 分别跳转 Console `#/recycle/customers`、`#/recycle/recruit`；删除两个旧页面渲染器及仅供其使用的状态/样式，保留恢复服务与数据语义。
4. **活动统计**：旧客户/增员统计路由跳转 Console `#/activity-report/customer`、`#/activity-report/recruit`；保留可能出现于 URL 中的日期筛选，并对照指标后删掉重复报表 UI。若参数格式无法无损映射，则该路由暂缓删除。
5. **嘉宾/主题独立目录**：旧 `#/speakers`、`#/topics` 跳转至 Console 对应目录；删除仅用于独立目录的 admin UI。先保留 `showActivityDetail` 所需的资源/嘉宾/主题 helper，直到调用者审计证明无 Legacy 消费者。

### 不纳入此次清理

- `showActivities`、`showActivityDetail` 及活动详情关联的写入函数：Console 有对应操作，但 admin 内存在多个直接调用方，且尚未核清所有字段/行为等价。
- `renderOpportunities`、客户机会详情：Console 明确把旧客户机会留在 Legacy 客户详情。
- 客户/Person/招募详情、附件、传统跟进、快速记录、AI 建议历史、今日教练、漏斗、Legacy 选客工具。
- 任何数据库对象、Cloud Function、HTTP/前端 Route、API 字段契约、登录与 RLS 行为。

## 旧入口兼容与回滚

- 兼容层只负责将旧 hash 导向指定 Console 页面，使用 `location.replace` 或等效方式，避免保留第二套可操作业务页面和制造重复历史记录。
- 统计路由保留日期范围；其他目标不带业务 ID，无需猜测转换。
- 若 Console 页面加载、权限、数据口径或恢复结果与旧页面不一致，恢复对应旧路由实现即可；每项独立提交，便于单项回滚。
- 不碰仍由 Legacy 内部调用的共享活动 helper。发现额外消费者时停止该子项并修订清单。

## 验收回归范围

- 路由兼容：`tests/console/more-navigation.browser.cjs`（直接打开旧 URL 的断言需改为验证被导向的 Console 页面）；`tests/regression/smoke.cjs`；`tests/pc36/live-ui-readonly.cjs`。
- 账号/登录：Console 设置页中英文与 iPad 布局；密码校验与失败提示、退出登录、强制刷新确认；未登录和登录态恢复。
- 招募目标/报告：PC21 活动统计与目标；招募目录/详情、目标月份、日期范围、空数据及筛选边界。
- 回收站：PC35 人物/客户/增员恢复、权限隔离、软删除语义；不对真实客户执行破坏性操作。
- 嘉宾/主题：活动资源目录、Person 关联、活动详情资源读写；确认 Legacy `showActivityDetail` 内部调用仍正常。
- 发布前运行对应 browser tests 和仓库规定的 regression；因公共导航/路由改变，按 AGENTS 运行跨模块 regression 并记录结果。

## 证据限制

本报告基于本地源码和测试静态消费者审计，没有运行额外业务测试，没有读取生产客户记录，也没有验证线上浏览器行为。特别是旧/新活动统计指标口径和活动资源所有字段等价性仍需在实现前用隔离夹具实测。
