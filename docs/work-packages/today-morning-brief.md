# Today 晨间简报工作包

## 范围与兼容

在现有 `today_coach.daily_review` 增加显式 `view: 'morning'`。不带 `view` 的今日/近 7 天复盘契约及其页面保持原样；Today 5 的生成、缓存、承诺提醒卡片也保持原样。`#/today` 另加按需生成的模块化晨间简报卡片，进入页面不会自动调用简报模型。

本轮无数据库结构或权限变更，无 migration/rollback；仅读取 `public` 的统一 Action 及兼容视图、承诺、活动、正式机会和待审核机会候选。没有读取或依赖其他 schema。服务端沿用 `CRM_TODAY_DB_API_KEY`，先核验真实登录身份，限定字段、分页上限和 `public` 读取。未读取到记录只表示 CRM 当前记录不足，不等于现实中没有机会或风险。

## 输出

1. **Morning Brief**：数据库事实的简短概览；模型只能从预设工作建议中选择一项，失败时使用确定性建议。
2. **Top Actions**：沿用 Today 现有六维规则排序，从统一 Action 和兼容行动视图中取前五项。
3. **Commitments**：逾期与未来三天到期的开放承诺，各最多 50 项，并提示截断。
4. **Upcoming**：未来七天的活动和已排期行动，最多 10 项。
5. **Risk**：有记录依据的逾期承诺和行动，最多 10 项；不推断其他未记载风险不存在。
6. **Opportunities**：未关闭、未成交、未软删除的正式机会，显示最多 10 项。
7. **Need Confirmation**：草稿、已预览或已确认但尚未正式创建的机会候选，显示最多 10 项，并跳转 Person 360 人工处理。

正式机会与候选严格分开；生成简报不创建、更新、关闭或删除任何业务记录。模型返回值不能改写名称、日期、行动、机会或承诺事实。

## 验证记录

- 修改前：本地、GitHub master、线上 `admin.html` 与 28 个 Cloud Functions 源码一致，基线提交 `75e6ce1f4fa1688d5891f83107315aa9ab3d51e0`。
- 线上 `public.commitments`、`public.opportunities`、`public.opportunity_candidates` 和 `public.persons` 结构与本轮读取字段一致；前两类候选和承诺目前无记录，因此真实有值分支依赖隔离数据测试。
- 隔离单元测试验证七段结构、事实来源、认证门槛、仅公共表读取、候选与正式机会分离、模型建议白名单及空数据降级：`node --test tests/today-coach/*.cjs`，9 项通过、0 失败。
- 完整回归覆盖登录、客户列表/详情、跟进、Today、新晨间简报、旧今日复盘、漏斗、活动、嘉宾、增员、回收站与 Quick Capture：`npm test`，89 项通过、0 失败、5 项因环境或用例条件跳过。
- 发布后只读取回线上 `today_coach/index.js`、`morning-brief.js`、`action-facts.js`、`db.js`，哈希与本地一致；线上 `admin.html`、新模块与 CSS 的 SHA-256 也与本地一致。
- 用独立浏览器中的 CRM 测试账号执行线上只读验证，`today_coach.daily_review({view:'morning'})` 返回全部七段，建议来源为 AI；验证脚本只上报段落名与通过状态，不上报客户数据，不写业务表。

## 影响与限制

- 原 60 秒云函数超时维持不变；模型工作建议最多等待 10 秒，失败时简报事实仍可返回。
- 所有列表有明确上限，简报数字只表示已读取并显示的记录，不宣称全库精确总数。
- 本轮不调整 Today 5 算法、旧复盘提示词、模型配置或任何业务写入流程。
