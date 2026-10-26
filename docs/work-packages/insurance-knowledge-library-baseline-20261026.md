# 保险业务资料库与双建议实施基线（2026-10-26）

## 执行结论

本项目可以沿用现有 Console、`knowledge_items` / `playbooks`、AI Gateway 和 AI Runtime 建设资料库与双建议。V1 不需要向量数据库。应新增受控文件来源登记、文档提取/治理和双候选完成/选择接口；旧 `ai_recommendations` 和 `ai_recommend` 默认行为继续保留。

## 基线与证据

- 本地 `master`、GitHub `origin/master` 同为 `ae4f6b39899afca77dd919bf610043dc2970766a`，标签为 `release-20261026-233928`；没有本地提交领先或落后。
- 工作树存在其他工作的未提交改动：`cloudfunctions/person_360/recruit-directory-service.js`、`docs/work-packages/recruit-directory-person-source-separation-20261026.md`、`tests/pc31/recruit-directory.test.cjs`。知识库实现应避开这些文件，并在发布时原样保留。
- CloudBase 环境 `crm-d1gkae8ddc930d151` 状态 `NORMAL`，PostgreSQL 已启用，默认 schema 为 `public`，运行角色 `cloudbase_postgres`；静态托管状态 online、默认域名路由启用。
- `tools/sync-check.ps1 -CloudOnly` 通过：线上 `admin.html` HTTP 200 且 SHA-256 匹配；85 个被页面引用的模块/样式资源匹配；29 个 CRM 云函数、214 个源码/配置文件匹配。函数证据保留在 `D:\Temp\crm-cloud-audit-80b0e170e1a04d72b2e56d9acf094a96`。该核对不包含业务回归。
- 线上 `public.knowledge_items` 有 2 行；`public.playbooks` 有 1 行；二者均启用并强制 RLS，只有现有服务端策略。`knowledge_items` 已含来源、发布日期、有效期、版本、生命周期、`metadata` 和 `supersedes_id`。`playbooks` 已含证据/案例/故事引用、版本、有效期和 `metadata`。无需改 item_type CHECK；各业务大类可由 metadata.domain 表达。
- 线上 `public.ai_results` 有 69 行，字段已包括 `task_id/run_id/result_json/rank/is_recommended/user_selected/user_edited/final_result_json/feedback`。该表有 `(task_id, rank, id)` 索引，无“一 run 只能有一个结果”的唯一索引；复合外键关联同一 `public.ai_runs` 的 task/run。
- 线上 `public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)` 的成功分支目前只插入一条 `ai_results` 并返回一个 `resultId`。因此当前 Gateway+RPC 合约实际不支持单次 run 生成两条独立审计结果，尽管表结构允许多条。建议新增双候选完成 RPC 或以版本化参数扩展该合约；不要改变旧 Skill 默认路径。候选使用 rank=1/2，各自独立写 `result_json`，明确选择单条。
- 旧客户建议仍走 `ai_recommend` 写入 `public.ai_recommendations`；Console Person 页面已有 AI 历史和 AI 能力入口，Gateway 数据访问由 `assistant` 等服务端调用者完成。新双建议优先接入 Console Person 客户上下文和 AI Runtime，不替换旧历史记录。
- Console 顶部主导航由 `crm/js/modules/console/shell.js` `navItems()` 构建，当前顺序含“AI 助手”后接“更多”；知识治理路由/页面、i18n、data API 已存在。新增“知识库”顶级菜单可定位到新的 Console 页面，保留 `#/knowledge-governance` 与 More 的历史链接兼容。
- Console 文件导入已有通过 `callFn` 传 Base64 的 4 MiB 文件处理边界。知识原件可限定为 3 MiB 以为事件封装留出空间；不新增浏览器端 RDB/Storage 写入。需继续验证独立文件服务与私有对象存储所需配置和部署边界。
- 当前活动模块已有沙龙、主题、讲者等记录。知识库中的健康/财富沙龙应先作为可审核模板/知识管理，不复制或改写活动记录。绩优分享须记录署名/匿名授权及可迁移范围，并阻止未经去标识的客户个案或健康/保单信息进入可检索状态。

## 推荐的最小扩展

1. `knowledge_items` 与 `playbooks` 保持为已确认知识正文/结构化策略唯一事实源，以 `metadata.domain` 区分产品、公司、服务、招募、行业、竞赛、健康/财富沙龙、绩优分享、法务税务等。
2. 新增一个 `public.knowledge_sources` 作为原件、版本、hash、文件类型/大小、提取状态、地区/辖区、章节定位和来源信息登记；原文件放私有存储。正文通过 source_id + locator 可追溯，不在两处重复存全文。
3. 草稿只在服务端暂存或以 draft 生命周期保存，不进检索上下文；由唯一操作员显式确认后才可检索。过期、失效、地区不符、授权撤销内容在查询时排除。
4. 新增版本化 `dual_followup` Skill 与服务端检索：A 只取已确认行业/国际经验、合规的绩优方法、相关 Playbook/案例；B 取已确认并在适用地区和期限内的公司产品/服务/政策、沙龙/招募/竞赛和相关案例。共享同一客户快照，A/B 使用不同引用 allowlist。
5. 为单次 Gateway run 写入两个 `ai_results` 的版本化原子 RPC；新增人工选择/修订 RPC，只标记候选，不创建跟进、Action、Opportunity 或产品数据。历史能读回两份内容与引用版本。
6. 文件处理可由专用、受保护的服务端功能承载，避免碰触有未提交招聘目录变更的 `person_360` 工作树内容。若 CloudBase 现有函数创建/权限流程无法在发布安全门内完成，则暂停该包并报告。

## 已核实的影响面

- 页面：`shell.js` 主导航；`router.js`；`pages/misc.js` 或独立 Console 知识库模块；`knowledge-governance.js`；Person 详情中的新双建议入口；必要的 `views.js`、CSS 与 `i18n.js`。
- 服务端：建议使用新 Knowledge Library / AI 双建议入口或明确隔离的现有安全服务端路由；避免部署当前有本地未提交招聘改动的 `person_360`。若新增函数，需核查 CloudBase 创建、调用权限、环境变量和 `cloudbaserc.json` 发布路径。
- 数据：现有 `public.knowledge_items`、`public.playbooks`、`public.ai_tasks`、`public.ai_runs`、`public.ai_results`；拟新增 `public.knowledge_sources`、双候选完成/选择 RPC，全部 public 限定并成对迁移与 rollback。先核实依赖视图和权限，再迁移。
- 保持旧 `ai_recommendations` 列表、URL、DTO、函数入参和默认行为；保持 More 中旧知识治理路由可达；新候选无默认选择。

## 风险、未知项与实施门槛

- Gateway 当前兼容服务端 `service_role` AI Runtime，而普通 CRM 匿名 RDB 通道不可访问这些快照表。双建议服务端需要复用现有 API Key / service-role 安全注入方式，绝不能把密钥送到浏览器。
- 需查清 CloudBase 环境里已创建/可配置 AI 模型组、上传限制、函数调用权限配置和存储服务接口。不能假设新函数已部署或模型已配置。
- DOCX/PDF 提取需使用现有 Node 18/20 运行时兼容实现；不支持的扫描件、加密件应明确拒绝，不得声称完成学习。知识录入失败不污染已确认内容。
- 目前无法仅凭表结构核实 `ai_tasks`、`ai_runs` 全部约束、公共 RPC 的 migration 历史和视图依赖；进入 WP1 执行迁移前须按项目规范复查线上 `public` 元数据和迁移台账。
- 实际模型调用、真实登录 iPad 操作和上传真实材料均未执行；知识库只有少量既有条目，绩优分享内容必须由用户提供并授权。

## 回归范围

知识治理列表/新建草稿/确认/修订/失效、More 旧入口/URL、Console 顶栏与活动沙龙入口、Person 详情/AI 历史、AI Gateway 与既有 Skill、双候选同快照/独立来源白名单/选择与回显；登录/会话、人物列表与详情、跟进、活动、招募、回收站。选择候选不能产生任何业务写入。

## 本基线结论

可进入资料来源数据契约和隔离实现设计。所有数据库迁移仅作用于 `public`，不删改旧对象；所有新 AI 操作必须经过服务端边界，模型由 Gateway/CloudBase 配置选择，双候选都需用户明确选择。发布前若出现未知权限、部署或存储配置，不以临时放权或公开链接绕过。

## 2026-10-27 继续施工复核

- 当前开发基线已推进至 `45fb94c304dc82340c9bb5dcdbd33e84bb55c8e1`（本地 `master` 与 `origin/master` 一致）。此处保留 10 月 26 日原始审计记录，不把原记录中的 `ae4f6b3` 当作当前 HEAD。
- 知识库迁移 `20261026150000_insurance_knowledge_library`、`20261026160000_knowledge_source_private_originals`、`20261026170000_knowledge_source_review` 已在 `public` 线上应用并只读核实；没有资料行或上传原件。原件采用 service_role-only 的 `original_base64` 保存，不依赖公开 Storage 桶或全局存储 ACL。
- 人工资料导入、提取、审核、重试和双建议服务已进入实施；页面只经 `assistant` / `person_360` 既有 `callFn` 桥接。以下仍需本轮发布后再记入独立进度和发布记录：实际在线部署核对、已配置模型下的真实 AI 生成、真实材料上传以及登录态 iPad 验收。
- 当前工作区还存在独立招聘目录工作包的未提交改动。发布时仅纳入知识库文件；招聘目录差异保留在本地且不随本轮部署/提交。
