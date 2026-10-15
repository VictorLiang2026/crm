# PC10 人物关系网络与转介绍路径

日期：2026-10-15  
状态：已完成实现、离线/只读回归、函数与静态部署、Git 发布及发布后完整三端核对。
起始基线：隔离发布工作区 `D:\CRM\crm-pc08-work`，GitHub `master` / CloudBase 同步提交 `c14f2e5e04c90f818b75577f3ba0a83ce95525e4`。发布期间并行修复已提交至 GitHub `2ad3a2c6970820fca0203ca6dc30928536bde658`（today 徽标回退、对应测试与记录）；已快进合并并保留，不覆盖。主工作区其他会话文件未纳入本包。

## 变更范围

- 在 `person_360` 增加经过既有登录校验的关系网络、邻居展开、转介绍路径读取和 AI 建议 action。读取仅使用 `public.relationships`、`public.persons`、`public.households`、`public.household_members`，限定存活人物和已确认关系；服务端最多返回 50 个节点、100 条边、50 条路径。
- Person > 关系页增加有向邻接列表、按需展开、一至两跳路径证据、单独的家庭成员区和 AI 介绍建议。所有人物跳转按 Person ID；没有有效路径时明确显示证据不足。
- AI 建议前由服务端重新读取所选完整路径并核验方向、状态、端点及人物存活。模型只生成供人审阅的临时建议，不保存、不创建机会、不联系任何人。家庭成员关联不参与转介绍路径。
- 新增简体中文/英文词条与 iPad 横竖屏样式；未变更旧 `ai_referral(customer_id)` 契约、机会工作流、关系编辑、数据库结构或权限。

## 文件与发布产物

- 云函数：`cloudfunctions/person_360/index.js`、`cloudfunctions/person_360/relationship-network-service.js`
- 静态模块：`crm/js/modules/console/data.js`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/person.js`、`crm/js/modules/console/relationship-network.js`、`crm/css/person-360.css`
- 测试/设计：`tests/relationships/relationship-network-service.test.cjs`、`tests/pc10/relationship-network-ui.browser.cjs`、`specs/person-network-introduction/`
- `admin.html` 未改变；migration/rollback 均为零；测试种子、数据库权限和业务数据均未改变。
- 已部署 `person_360` 和上述五个 PC10 静态文件，不执行全项目上传。
- 发布核对发现基线后 CloudBase 单独更新了 `crm/js/modules/console/pages/today.js`（文件最后修改时间 2026-10-15 20:13 +08）。线上增加的是未识别 Action 等级时按工作项状态显示徽标的单条回退。经用户明确确认后已把该线上代码同步到本地/Git 源码；线上与本地逐字节一致，未再次上传该文件。

## 验证

- `npm run test:pc10`：通过，服务端 6 项、浏览器隔离测试 2 项。
- `npm run test:pc04`：8 项通过。
- `npm run test:pc08`：复跑后 12 项通过。首次并行运行有一次 820×1180 溢出，独立复跑通过。
- `npm run test:pc09`：13 项通过。
- `npm run test:context-engine`：21 项通过；`npm run test:modular`、JS 语法检查和 `npm run check:shared` 通过（58 份共享模块副本一致）。
- WP01 release gate：`PASS_WITH_LIMITATIONS`。刚采集的 public-only catalog 通过 881 项检查（52 tables、12 views、37 sequences、45 routines）；身份审计通过，保留 3 条已登记的活动参与者例外；匿名网关检查 64/64；完整 Legacy 隔离回归 108 PASS、5 个预设 SKIP。
- 发布：GitHub `master` 提交 `d4d5e1dc83dd7733a4c45195038e78b1c4076083`，标签 `release-20261015-205604`。发布后完整 sync-check 通过：55 个可达静态资源、29 个云函数共 182 个源码/配置文件、主页面 HTTP 200 且哈希匹配；本地/GitHub/CloudBase 一致。
- 登录人工探针、service-role 运行态、线上 AI/路径调用和真实写入未执行。代码不写业务记录；生产认证后的 UI/AI 路径仍需后续人工运行验证。
- `person_360` 线上无数据烟测调用返回预期 `{ "error": "Unknown action" }`，Duration 1ms；该无效 action 不访问数据库。CloudOnly 检查通过：55 个可达静态资源一致，29 个云函数共 182 个源码/配置文件一致，`admin.html` HTTP 200 且哈希一致。
- 额外直接运行 `tests/households/person360-opportunities.cjs` 时，其中“Person list merges linked and legacy customer-only opportunities”夹具失败：测试 mock 断言第一张访问表必须为 `opportunities`，而当前 `listOpportunities` 已按 PMC-19 CL-03 先通过 `customers.person_id` 查 customer。PC10 没有改该方法；同一流程在 WP01 全量 Legacy 回归的 `person360.opportunities` 与 `person360.opportunity-candidate-preview` 均通过。该过时夹具不在 PC10 修改范围内。

## 回退与未完成项

- 若静态界面或函数出现问题，恢复基线标签 `c14f2e5e` 对应版本，并仅重新部署本包的同一函数/静态文件；无需数据库回滚。
- 上述发布和三端核验已经完成；恢复目标为标签 `release-20261015-205604`。
- 旧 `ai_referral` 仍保持既有行为；正式机会继续走已上线的候选确认与 preview/execute 流程。
