# 保险业务资料库与双建议施工进度（2026-10-27）

## 本轮已实现

- `public.knowledge_sources` 登记来源类别、标题、发布方、地区、日期、版本、文件名、摘要状态与 SHA-256；原件放在 service_role-only 的 `original_base64` 列，限制 3 MiB。支持 PDF（调用现有提取器）、DOCX、UTF-8 TXT；重复文件按 SHA-256 拦截。
- 单人 Console 知识库页可上传、AI 提取知识摘要/要点/营销应用/边界、查看草稿、重试失败提取，并由唯一操作员逐条审核。未经审核内容不会进入检索。法务税务需要辖区、链接、发布日期；绩优分享要求授权和匿名，并扫描明显个人标识信息。
- 服务端检索仅取已审核、未过期、未到复核日且辖区匹配的资料。双建议共用 Person 360 客户快照，生成“行业经验与销售策略”和“公司资料库建议”两条结构化建议；A/B 的引用 ID 分开校验。没有匹配资料时明确标记，不伪造引用。
- Person 360 增加双建议入口；两条建议同时显示。选择经服务端 `crm_ai_select_dual_v1` 记录，只保存所选 AI 结果，不创建跟进、行动、机会或消息。历史接口可读取同任务的两条建议。
- Console 顶部新增“知识库”，顺序为“AI 助手 → 知识库 → 更多”。旧 `#/knowledge-governance`、More 内容和旧 `ai_recommendations` 继续保留。
- 新增知识提取和双建议技能；模型和模型组仍由 Gateway/CloudBase 配置决定。双候选由 `crm_ai_finish_dual_v1` 原子写入，不改变旧单建议 finalizer。

## 代码影响面

- 服务端：`assistant` 新资料库动作、Gateway 双结果持久化、RPC allowlist、双建议技能；`person_360` 只增加受登录保护的 PDF 文本提取动作。
- 前端：Console shell/navigation、router、data facade、knowledge governance page、Person page、双建议页、i18n、Console CSS 与图标。
- 数据库：知识库核心依赖三份已应用且有 rollback 文件的 `public` 迁移；本轮另应用 `20261027130000_private_knowledge_source_sequence`，关闭 `anon`、`authenticated` 对私有资料源 ID 序列的读取/使用权限。迁移版本与 SQL 已从远端历史核实；新权限已由 fresh public catalog 核实，并加入明确安全基线。回滚脚本记录于同目录。未触碰其他 schema、既有表删除/重命名或业务数据。

## 验证

- 单元：资料 Base64 上限/规范性、DOCX 错误输入、绩优隐私扫描；Gateway 双候选排序、同一快照与两结果落库。
- 浏览器：双建议双卡同时显示、引用、明确选择；知识治理双语/审核兼容；Console 菜单顺序与 17 条旧 URL；人物页面、More 旧链接。
- 已运行并通过：`npm run build:shared`、`npm run check:shared`、`npm run test:knowledge-library`、`npm run test:ai-skills`、`npm run test:ai-gateway`、`npm run test:pc22`、`npm run test:pc23`、`npm run test:pc03`、`npm run test:modular`、`tests/more-consolidation/m14-knowledge.browser.cjs`；完整 WP01 复归跑通过 108 项、0 失败、5 项预设跳过，PC34 双语/iPad 回归通过，匿名探针 77/77 通过。WP01 的状态为 `PASS_WITH_LIMITATIONS`：真实登录摘要、service runtime、生产写入和手机行为仍标为未验证。
- 未验证：真实登录账号上的在线上传、实际 AI 模型配置下的模型输出质量、线上部署后的真实浏览器行为。本进度不把 Mock/离线回归表述为线上端到端成功。

## 发布结果与后续验证

- 已部署 `assistant`、`ai_activity`、`person_360`，并上传本轮改动的 9 个 Console JS 文件与 `crm/css/console.css`；`admin.html` 未变。
- 已提交并推送至 GitHub master：`40f868878fa864ff423ca13372fe3eaeb630e754`；标签：`release-20261027-011555`。发布脚本确认本地、GitHub、云端源码一致。
- 发布后核验通过：87 个可达页面/模块/样式资源、29 个云函数共 217 个源码/配置文件。目标静态文件 ETag 与本地 MD5 逐项匹配。
- WP01 为 `PASS_WITH_LIMITATIONS`，无发布阻断项；当前缺少一小时内真实账号登录摘要，因此还未完成登录后的真实页面上传/审核验收。按 `tests/wp01/README.md` 在独立窗口运行 `npm run test:wp01:login` 后可补验。service runtime、生产写入/恢复、真实 AI 输出质量与手机行为仍未验证。
- 尚未导入实际公司、产品、沙龙、绩优分享或法务税务材料；收到用户提供并授权的资料后再做导入与内容质量评估。
- 独立招聘目录的三处并行工作已恢复在本地工作区，未纳入本次提交或部署。

## 2026-10-27 知识列表与摘要优化

- 首页标题更新为“知识与策略”；列表改为 iPad 优先表格，展示标题、知识类别、摘要、来源日期、有效期、审核状态与操作；每页 20 条，并可按类别、类型、状态筛选，表头排序。
- 搜索默认只匹配标题；勾选“全文搜索”后匹配标题和独立摘要，不搜索原始资料全文。已有旧条目若无独立摘要，临时展示正文开头并提示补充；新手工知识和上传提取知识将 AI 摘要写入 `knowledge_items.metadata.summary`，可人工编辑。
- 新增知识编辑入口：已审核条目创建新的待审版本，审核通过后才替代旧版本；草稿采用更新时间乐观并发保护；失效仍走原审核 RPC，不物理删除。来源上传与对话策略录入折叠保留。
- 延续资料边界：行业/法务税务知识必须提供辖区、HTTPS 来源和发布日期；绩优分享需要操作员确认授权及匿名化，并拒绝检测到的明显个人标识信息。模型仍由 AI Gateway 配置，不新增厂商硬编码。
- 数据库无变更，无 migration/rollback；改动范围限定在 `assistant` 知识服务、知识治理 Console 模块、该模块 i18n/CSS 与知识库回归测试。人物、跟进、活动、增员及回收站接口未改。
- 本地回归通过：知识库与 PC22 相关测试 25 项、PC22 完整回归 12 项、Console 模块边界检查和共享模块一致性检查；覆盖标题/摘要搜索、双语、列表表格、审核兼容及 Gateway 摘要/版本行为。发布后的云端一致性和 WP01 报告待本轮收尾补录。

### 本轮发布与验证记录

- 发布前刷新了 CloudBase `crm-d1gkae8ddc930d151` 的 `public` 只读目录快照（1149 项检查、65 表、12 视图、38 序列、78 routines）和 WP04 身份审计快照；catalog 无权限漂移，身份审计 `PASS_WITH_EXCEPTIONS`，保持既有 3 条明示例外。
- 完整 WP01 隔离回归：108 PASS、0 FAIL、5 个预设 SKIP；匿名探针 77/77；PC34 的服务角色只读、双语 iPad 触摸/键盘验证通过。发布门槛为 `PASS_WITH_LIMITATIONS`，开放项是人工登录、service runtime 写操作、线上业务写入及真实手机行为。
- 静态托管已按 3 个明确文件上传：知识治理模块、Console i18n、Console CSS；`assistant` 按最终代码再次成功部署。`sync-check.ps1 -CloudOnly` 已核实 `admin.html` 相同、89 个可达页面/模块/样式资源一致，以及 29 个 CRM 函数的 219 个源码/配置文件一致。
- CloudBase MCP 的 `invokeFunction` 返回平台 `Cam authentication failed`，CLI 只读调用也返回非零退出；线上知识列表函数调用因此未验证。离线服务单测和浏览器回归通过，不将其写成线上运行通过。
- 最终 WP01：`PASS_WITH_LIMITATIONS`，catalog 1149 项无漂移，匿名探针 77/77，隔离回归 108 PASS、0 FAIL、5 SKIP。开放项仍为真实登录、service runtime 写操作、线上业务写入和手机真机行为。
- GitHub master 提交和 release 标签：随本轮 `tools/release.ps1` 发布后补记；本地/线上 CloudBase 源码一致性已通过，GitHub 同步以发布脚本和最终完整 `sync-check.ps1` 为准。
