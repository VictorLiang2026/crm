# Today Coach：统一 Action 优先的排序

2026-09-28 工作包。线上基线为 `87185a0662b8d09813c52e30b918d924061d964c` / `release-20260928-201912`。

`today_coach.generate` 与缓存指纹检查先在服务端读取 `public.actions` 中 `open` / `in_progress` 的记录及对应的 `public.persons`，再读取原有 `public.v_action_center` 候选。新 Action 的标题、截止日期、状态、优先级、来源和关联 Person 均以数据库为准；软删除 Person 与客户的 Action 不展示。同一机会被新 Action 明确关联时，以新 Action 为准，不再重复显示旧机会候选。旧视图、旧 `today5` / `items` / `all_actions` 字段和 `candidates` / `cockpit` / `daily_review` 动作保留。数据库结构、RLS 和旧视图均未修改。

基础分使用六维：Urgency（数据库截止日期与可选入库分）、Impact（入库分或优先级）、Confidence（入库分或现有资料完整度）、Effort（入库分或中性估计，排序时反向计分）、Relationship Value（最近跟进的时间间隔）、Opportunity Value（已关联的有效机会）。缺少入库分时采用确定性默认值。新 Action 获得有限的优先加分；紧急的旧候选仍可进入 Today 5。AI 只能增强候选排序，并补充排序解释、沟通渠道和开场话术；AI 输出的行动、日期、目标、证据、可信度均被忽略。五项输出 `why_now`、`what_to_do`、`expected_objective`、`preparation`、`risk` 始终有规则兜底，Today 页及首页卡片可展示。

服务端使用专为 `today_coach` 创建的 `CRM_TODAY_DB_API_KEY` 环境变量读取上述两张 `public` 表，不将密钥返回浏览器或写入仓库。函数内拒绝缺少 UID 和匿名身份；线上云函数安全规则也拒绝匿名调用。`AI_MODEL` 与 `TCB_ENV` 保留。密钥到期日为 2026-12-27，届时需轮换。现有 `public.actions` 目前为 0 条，因此线上真实 Action 排序须待有明确标记并经人工确认的 Action 后验证，不创建测试业务记录。

回滚代码可从上述基线恢复 `today_coach` 和 `admin.html`，并重新发布这两个产物；随后删除或停用本函数的专用环境变量，并评估是否吊销专用 API Key（确认没有其他依赖后执行）。本工作包没有数据库 migration 或 rollback，因为没有数据库变更。

验证记录：`node --test tests/today-coach/action-facts.cjs` 4/4 通过；完整离线回归 63/63 通过，5 项线上或设备相关检查按测试框架跳过（隔离运行 Edge，生产网络访问被测试框架禁止）。`admin.html` 已按单文件上传，线上下载 SHA-256 与本地一致；`today_coach` 已单独部署，管理端无登录身份调用返回 `UNAUTHORIZED`。项目云端源码核对覆盖 27 个 CRM 函数、118 个源码/配置文件，全部与本地一致。由于当前无法启动可交互的独立测试浏览器，真实账号下的 Today 页面和新 API Key 查询尚未完成端到端验证。发布提交和标签由本轮发布脚本生成。
