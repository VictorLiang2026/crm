# Person 中心化迁移：任务清单（PMC-00～PMC-20）

状态标记：`[ ]` 未开始、`[~]` 执行中、`[?]` 待确认、`[!]` 阻塞、`[v]` 待验证、`[o]` 观察中、`[x]` 已验收（开发完成 ≠ 已验收）。

规则：一次只执行一个包；各包详细指令由用户下发后登记到"指令登记"栏；未收到的指令不猜写。前置包未验收不进入下一包。

## 任务列表

- [x] **PMC-00｜接管检查及执行档案建立**　依赖：无。
  - 指令登记（2026-10-07 用户下发，摘要）：只读接管检查——阅读 AGENTS.md、环境与安全边界文档、specs/target-crm-v1 及 Person/客户/招募/活动/互动相关架构与工作包文档；核实本地分支/提交/未提交文件/GitHub/云端基线并辨明归属；核实 Trae 可读项目规则与本地 SKILL.md，核实终端、Git、CloudBase、数据库只读查询与发布工具；schema 限 public、禁 pr/pr_*。检查通过后建立本目录九类文档及 execution-contract A–N 约定。只执行 PMC-00，不修改业务代码或业务数据。
  - 验收：规则、基线、工具、未提交改动归属和文档入口均有证据；不能完成的检查明确列为阻塞；后续 Codex 能仅凭仓库文档了解接管状态；文档发布后停止等待 PMC-01。
  - 结果：全部检查通过（无阻塞）；4 项缺口登记（非阻塞）；发布标签见 [evidence/PMC-00.md](evidence/PMC-00.md)。2026-10-07 用户追加指示处置缺口：G1–G4 全部关闭——G2 tcb.ps1 守卫、G3 pg-readonly 工具、G4 核实为过时记录；G1 外部迁移双备份经用户授权执行同步脚本，82/82 哈希一致、25 份旧稿归档（release-20261007-125802 及后续文档补录标签）；同日核实 PMC-01 未开始（指令未收到）。
- [v] **PMC-01｜Person 中心化迁移全量影响盘点**　依赖：PMC-00 验收。开包日期：2026-10-07（同 PMC-00 G1–G4 缺口处置闭包后）。
  - 指令登记（2026-10-07 用户下发，原文要点）：只做只读审计和文档更新，不修改业务代码、表结构或业务数据。六项任务：① 重新核实 public 的表/字段/约束/索引/触发器/函数/视图/授权/RLS，统计字段重复/Person 缺失/孤立引用/软删除不一致/冲突（不输出真实个人资料）② 本地配置/源码/线上 CRM 云函数交叉盘点，按"函数 × action"逐项记录 ③ 初始范围 28 个函数（customers/person_360/assistant/followups/opportunities/activities/activity_speakers/activity_tasks/activity_reports/activity_topics/today_coach/funnel_insight/recruit_candidates/recruit_followups/recruit_goals/recruit_score/recruit_recommend/ai_parse/ai_followup/ai_recommend/ai_recommendations/ai_referral/ai_activity/policy_review_reports/ocr_records/photos/gifts/products），新发现相关函数纳入矩阵 ④ 沿完整调用链检查 admin.html / crm/js/modules/console / callFn / 数据库 RPC / 视图 / 共享模块副本；特别核实嘉宾创建查/建 customers、OCR 删除后前端快照恢复 customers.update、漏斗/招募经视图间接读客户字段、Quick Capture/新旧 Person 服务写入、共享模块副本遗漏 ⑤ impact-matrix 至少含 13 列（对象/action/入口/读取字段/写入字段/实际身份 ID 类型/当前权威来源/目标来源/权限上下文/上下游依赖/对应工作包/兼容办法/测试/部署顺序/回滚条件），标记"需修改/仅回归/已核实无影响/未知"并附证据 ⑥ 更新 requirements/design 现状节及旧文档索引；旧文档与当前事实冲突时说明核实日期和证据，保留历史记录。
  - 验收：核心读写链路不得存在未解释的入口；未知项有具体补查任务，影响后续设计的未知项必须先解决。按执行约定更新交接、发布文档后停止。
  - 结果：六项任务全部完成；发布标签 `release-20261007-193230`（提交 `42787ff`）；证据见 [evidence/PMC-01.md](evidence/PMC-01.md)；未知项 U1–U8 已登记补查任务。
- [ ] **PMC-02**　依赖：PMC-01。指令：未收到。
- [ ] **PMC-03**　依赖：PMC-02。指令：未收到。
- [ ] **PMC-04**　依赖：PMC-03。指令：未收到。
- [ ] **PMC-05**　依赖：PMC-04。指令：未收到。
- [ ] **PMC-06**　依赖：PMC-05。指令：未收到。
- [ ] **PMC-07**　依赖：PMC-06。指令：未收到。
- [ ] **PMC-08**　依赖：PMC-07。指令：未收到。
- [ ] **PMC-09**　依赖：PMC-08。指令：未收到。
- [ ] **PMC-10**　依赖：PMC-09。指令：未收到。
- [ ] **PMC-11**　依赖：PMC-10。指令：未收到。
- [ ] **PMC-12**　依赖：PMC-11。指令：未收到。
- [ ] **PMC-13**　依赖：PMC-12。指令：未收到。
- [ ] **PMC-14**　依赖：PMC-13。指令：未收到。
- [ ] **PMC-15**　依赖：PMC-14。指令：未收到。
- [ ] **PMC-16**　依赖：PMC-15。指令：未收到。
- [ ] **PMC-17**　依赖：PMC-16。指令：未收到。
- [ ] **PMC-18**　依赖：PMC-17。指令：未收到。
- [ ] **PMC-19**　依赖：PMC-18。指令：未收到。
- [ ] **PMC-20**　依赖：PMC-19。指令：未收到。

注：PMC-01～PMC-20 的依赖关系暂按顺序编号占位；实际依赖以用户下发指令为准，登记指令时一并修正。

## 指令登记规范

收到 PMC-XX 指令时，在对应条目下新增"指令登记（日期）"：完整指令原文要点、验收范围、影响面、与 WP 体系的关系；同时更新 `handoff.md` 的"下一步唯一允许执行的动作"。
