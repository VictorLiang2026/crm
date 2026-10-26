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
