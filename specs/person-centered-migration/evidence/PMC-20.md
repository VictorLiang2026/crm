# Evidence: PMC-20 获批清理、最终回归与 Codex 交接

- 开包日期：2026-10-10。前置：PMC-19 CL-01~CL-09 全部执行并发布（提交 `0c511db`，标签 `release-20261010-1745`）。
- 指令（2026-10-10 用户下发，摘要）：执行 PMC-20 获批清理及最终交接。① 清理前重新核实四地基线与批准后新增消费者/数据/依赖；② 核实受保护备份完整性及恢复演练证据；③ 按批准小批次执行，每批立刻检查，不用 CASCADE、不清理顺带对象、不全量部署；④ 完成客户、Person、招募、嘉宾、参与者、关系、家庭、互动、Today、AI、搜索、统计、附件、删除恢复的最终回归（iPad 中英界面）；⑤ 更新架构/字段字典/接口契约/权限/migration 索引/影响矩阵/tasks/evidence，旧方案标记为历史；⑥ 部署、Git 发布、三端一致；⑦ handoff 终版供 Codex 直接接管。
- 验收：Person 承担全部人物基础信息；业务表仅保留领域字段、必要业务关联及批准保留的历史快照；获批冗余清理完成、未获批项如实列明；Codex 无需 Trae 私有记忆即可继续开发。

## 1. 范围

本包**不新增任何清理对象**——清理主体已由 PMC-19 CL-01~CL-09 执行完毕。PMC-20 执行：

1. 清理后终态复核（四地基线 + 新增消费者/数据/依赖排查）；
2. 修复清理暴露的运行时回归（云函数 + 3 个 DB 函数 + 前端 person-360.js）；
3. 备份完整性与恢复演练核实；
4. 全领域最终回归（隔离测试 + DB 只读探针 + 生产浏览器中英界面）；
5. 文档终态化与 Codex handoff。

## 2. 四地基线复核与终态审计（指令①前置）

- 本地：`master` @ `0c511db`（PMC-19 执行提交），工作树含本包修复与文档。
- GitHub：`0c511db` 已推送 origin/master；标签 `release-20261010-1745` 已推送。
- 云端：PMC-19 部署 5 函数（customers/person_360/assistant/ai_activity/today_coach）；11 视图已重建、customers 7 副本列与 persons.legacy_customer_id 已删除、复合 FK×2/桥触发器/recruit 同步触发器已退出。
- 迁移双目录：本地 `cloudbase/migrations` 与 `C:\Users\victor\cloudbase\migrations` 130/130 哈希一致。
- 终态审计（tools/pmc20-final-audit.sql + tools/pmc20-procs-audit*.sql 系列经 tcb-exec）：customers 剩余列仅 person_id + 业务字段；persons 无 legacy_customer_id；DB 函数体内对已删列的文本扫描发现 3 个坏函数（见 §4）。

## 3. 清理后新增消费者/数据/依赖排查（指令①）

- 新增数据：customers 783 行（软删 1）全部带 person_id（PMC-17 NOT NULL 约束在效），0 重复、0 缺失；persons 787 行（活跃 784）。
- 新增消费者： PMC-19 后代码扫描确认所有 JS 消费者已改道 `customers.person_id`；本轮复核无新增。
- **发现 3 个 DB 函数体内动态引用已删列**（PMC-19 静态扫描漏项，函数体文本扫描 tools/pmc20-procs-audit*.sql 发现）：
  1. `actions_guard()` 触发器函数——actions INSERT/UPDATE 的机会归属检查引用 `persons.legacy_customer_id`，所有 actions 写入运行时报错；
  2. `crm_person_roles_derive_v1()`——角色派生含 legacy 链接 OR 分支，触发器树调用失败；
  3. `crm_search_people_v1()`——AI 搜索三模板全部失败。
- 处置：按"修复兼容代码先行"批次原则，先修函数与部署，再逐批回归（不使用 CASCADE、不顺带清理）。

## 4. 运行时回归修复（指令③批次 1：兼容代码与部署先行）

### 4.1 3 个坏 DB 函数修复（migration + rollback + RPC 验证）

| 迁移 | 对象 | 修复内容 | 验证 |
| --- | --- | --- | --- |
| `20261010190000_pmc20_fix_actions_guard` | `actions_guard()` | 机会归属检查改经 `customers.person_id` 解析；identity/links/provenance 不可变语义逐字保留 | tools/pmc20-verify-guard-accept.sql（合法写通过）+ verify-guard-reject.sql（跨 Person 拒绝）✅ |
| `20261010190100_pmc20_fix_person_roles_derive` | `crm_person_roles_derive_v1()` | 移除 legacy OR 分支（customers 全量带 person_id 使其永久不可达）；软删 Person 清派生角色语义保留 | tools/pmc20-verify-roles.sql（customer/recruit/speaker/participant 派生正确）✅ |
| `20261010190200_pmc20_fix_search_people` | `crm_search_people_v1()` | 三模板 customer 解析改 `customers.person_id` JOIN；输出字段 `legacy_customer_id` 更名 `customer_id`（唯一云函数消费者 assistant/search-service.js 按 person_id 映射行、从不读 legacy 字段名） | tools/pmc20-verify-search.sql：activity_no_followup / child_education_no_insurance / declining_priority（p_months=12）三模板执行成功 ✅ |

各迁移含 rollback（原函数体逐字复原），双目录备份一致。均经 cloudbase_postgres 角色应用。

### 4.2 云函数修复（12 个，对 customers 已删列的运行时引用）

activity_reports、activity_speakers、activity_tasks、ai_activity（index+context-engine）、ai_parse、ai_recommendations、followups、gifts、photos、products、person_360（index+customer-profile-service）、today_coach —— 全部 `node --check` 通过。

### 4.3 前端 person-360.js（托管文件）

`crm/person-360.js`（admin Person 360 渲染器）适配 CL-03：客户链接经 `getCustomerProfile` 返回的 `customerId`（`customers.person_id` 解析）渲染 `#/customer/{id}` 链接。单文件 hosting 上传，SHA 与本地一致。

### 4.4 测试夹具适配

`tests/households/person360-service.cjs`：persons fixture 去 legacy_customer_id、新增 customers fixture `{Id, person_id}`、断言 `customerId='101'`——锁定 CL-03 新契约。

### 4.5 部署

- 12 云函数分 4 小批部署，每批字节比对一致；
- person-360.js 单文件 hosting 上传 SHA 一致；
- 3 个 DB 函数迁移经 cloudbase_postgres 角色应用（非全量部署、无 CASCADE）。

## 5. 备份完整性与恢复演练（指令②）

- PMC-19 全部 15 个 migration + rollback 双目录备份（本地 `cloudbase/migrations` 与 `C:\Users\victor\cloudbase\migrations`）130/130 SHA 一致。
- 恢复演练（tools/pmc20-recovery-drill-cl02.sql / cl03.sql，只读验证）：
  - CL-03 恢复链：`persons.legacy_customer_id` 可从 `customers.person_id` 全量回填——实测 783 distinct links / 0 missing（含 1 软删客户；rollbacks/20261010180000 回滚脚本已同步补强：回填不再过滤软删行，并注明与 170900/180100 的连续恢复链）；
  - CL-02 恢复：7 副本列恢复脚本可从 persons 现值回填真实值（非空列重建）。
- 恢复对清理后新记录的保护：恢复脚本以 `customers.person_id` 为回填源（NOT NULL 约束在效），清理后新增客户行天然携带映射；`actions_guard`/角色派生/搜索函数 rollback 为原函数体逐字复原，不影响数据行。
- 局限（如实登记）：平台层（腾讯云控制台）自动备份与真实恢复演练未执行——见 §8 未验证项。

## 6. 全领域最终回归（指令④）

### 6.1 隔离测试（node --test）

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| test:households | **5/5** ✅ | 夹具适配 CL-03 新契约（本轮唯一受影响的测试文件） |
| test:ai-gateway | **14/14** ✅ | |
| test:ai-skills | **7/7** ✅ | |
| test:recruit-goals | **3/3** ✅ | |
| test:modular | **PASS** ✅ | |
| check:shared | **PASS** ✅ | 58 副本一致（db.js `124c6ac6…`、ai.js `6fa94a41…`） |

基线遗留失败（非本轮引入，0c511db 及更早已存在，相关文件本轮未改）：test:context-engine、test:person-service、test:actions、test:quick-capture-v2、test:interactions、test:commitments（stash 干净 HEAD 复验同样失败）；test:wp01（i18n.js/misc.js WIP 未提交 + evidence 过期 + fn invoke Cam 认证失败所致）。按规则 11 只记录不修。

### 6.2 数据库只读探针（service_role，tools/pmc20-regression-*.sql）

63 项全领域完整性探针（tools/pmc20-regression-probe.sql）**全绿**：

- 主数据：persons 787（活跃 784）；customers 783（活跃 782，0 缺 person_id、0 重复）；recruit 15 活跃 0 断链；speakers 4 活跃 0 断链；activity_participants 4 活跃（3 个 snapshot_only 为 D6 批准保留的历史快照）；relationships 0 断链；households 0 行（无数据，空态正常）；interactions 9、followups 249、actions 4（1 open）、commitments、gifts 189、photos 8、products 1、ai_recommendations 26、ocr_records 6、opportunities——全部 0 断链。
- 回收站：customers 1 / persons 3 / recruit 3 / followups 1（软删语义在效）。
- 12 视图行数全部正常（customers_view 783、v_action_center 166、v_funnel_stats 19 等）。
- RPC：`crm_customers_page_v1` total=782；`person_directory_page_v1` total=784；`pmc18_collect_metrics` 返回正常；`crm_search_people_v1` 三模板执行成功。
- 富客户探针（tools/pmc20-regression-rich-customer.sql）：田泳（610）followups 8/gifts 7；王寻寻（770）followups 6/photos 5；佟紫颖（65）followups 5/gifts 5——与页面显示一致。

### 6.3 生产浏览器回归（iPad 布局，中英双语）

**console.html（AI-native 前端）**：

| 页面 | 结果 |
| --- | --- |
| #/today Today 面板 | ✅ 晨间简报 AI 建议（10月10日·星期六）、Today 5 来自 v_action_center 真实数据（含 1 逾期承诺提示）、优先行动、写入确认、候选审核、今日节奏、机会速览（2 条 → #/person/787、#/person/783） |
| #/people 人物目录 | ✅ 20 行真实数据（person_directory_page_v1），中英两版均正常 |
| #/person/773 Person 360 | ✅ 头部（AI 摘要/会前准备/对话策略/编辑资料/记录沟通按钮）、8 Tab、总览真实数据（客户阶段/优先级/最近互动）、"完整客户档案"→ admin.html#/person/773 |
| #/settings 中英切换 | ✅ 双向切换（Settings/Language/Today/People/Opportunities/More 全部翻译；切回中文正常） |
| #/ai/search | ✅ 3 模板按钮=3 个修复后搜索 RPC；模板 1 端到端"DB 匹配 0 人"空态正确（AI 解析→云函数→RPC 链路通） |
| 回收站 | ✅ #/customers/trash 1 条、#/recruit/trash 3 条（与 DB 一致） |
| 其他 | ✅ #/funnels 782 人分层、#/activities 列表、#/activity/11 参与者(1)、#/activity/2 参与者(3)+嘉宾段 |

**admin.html（Legacy 前端）**：

| 页面 | 结果 |
| --- | --- |
| #/person/773 Person 360 | ✅ 头部 `Person #773 · 客户 #770 · 最新客户资料`；三处 `#/customer/770` 链接（查看传统客户详情/编辑基本信息/查看编辑客户画像）= CL-03 新解析链路生效；角色徽章 `客户 · 旧记录映射`；CORE+更多资料字段；统一互动时间线；Fact/Signal/Inference；行动与承诺；关系节奏提醒；机会候选（测试人守卫 `TEST_PERSON_REQUIRED` fail-closed 正确）；保险概览 OCR 来源（public.ocr_records#8/#3/#2、photos#12-24，"待人工核实"标注）；家庭空态"只可选择已有 Person，且需人工确认" |
| 客户详情 #792 | ✅ 基础信息 + 跟进/礼物/相册 Tab（前轮子代理已验） |

浏览器 console 错误收集：0 应用级错误。

**发现（按规则 11 只记录不修）**：console 底部 FAB"快速记录"按钮的 `aria-label` 固定中文（可见内容为加号 SVG 图标，英文界面无视觉影响）——i18n 覆盖小缺口，登记待后续 i18n 迭代处理。**已于 2026-10-11 经用户批准修复并发布（见 §6.5）**。

### 6.4 回归结论

- 客户、Person、招募、嘉宾、参与者、关系、家庭、互动、Today、AI、搜索、统计、附件、删除与恢复全部通过（隔离测试 + DB 探针 + 生产浏览器三层）。
- 未验证项见 §8。

### 6.5 2026-10-11 追加：FAB aria-label 修复 + Cam 认证端到端回归

**FAB aria-label 修复（用户批准的登记项）**：根因不是硬编码——shell.js FAB 早已使用 `t('nav_quick_record')`，但 `setLang()` 只刷新 `[data-i18n]` 节点的 textContent，FAB 的 aria-label 在 mount 时求值一次，切换语言后不跟随。修复：①`i18n.js` 的 `setLang()` 与 `scanI18n()` 新增 `[data-i18n-aria]` → `aria-label` 同步（新机制，现存元素零影响）；②shell.js FAB 加 `data-i18n-aria="nav_quick_record"`。线上实测：中文「快速记录」→ English「Quick Record」→ 切回「快速记录」，实时跟随。**发布归属（核实后）**：本会话开发并先行单文件部署验证（SHA 一致）后，并行工作会话将该修复（连同 console 更多页 17 项旧版入口、person_360 时间线线上故障修复、测试夹具对齐、11 视图 security_invoker 恢复迁移）整合提交为 `bd3c9c5`、标签 `release-20261011-000403` 并推送；其发布流程重新部署的 i18n.js（含完整字典键）/shell.js/misc.js 为线上终态，本会话 2026-10-11 复核线上三文件 SHA 与 `bd3c9c5` 全部一致。原 i18n.js/misc.js WIP 已随该提交转正，不存在未提交 WIP 残留（本会话的隔离 stash 已被并行会话消费整合；另一 stash「pmc19-pmc20 untracked drafts」为并行会话标注 do-not-drop，未触碰）。

**Cam 认证端到端回归（核销 §8 旧第 2 项）**：用户在浏览器完成 Cam 登录后，逐页认证真实调用：

| 页面 | 结果（真实数据） |
| --- | --- |
| #/today | ✅ 早安问候、晨间简报（AI Gateway）、Today 5、待履承诺、候选审核、机会速览 |
| #/people | ✅ 20 行人物目录 |
| #/person/773 | ✅ 王寻寻 Person 360 正常渲染（5 区块） |
| #/opportunities | ✅ 机会列表与待确认候选真实记录 |
| #/activities | ✅ 活动工作台计数（11/12） |
| #/recruit | ✅ 候选人漏斗（陈旖俐等真实姓名） |
| #/settings | ✅ 中英双向切换 |
| #/ai/search | ✅「最近关系下降的重点客户」自然语言→AI Gateway 解析→数据库计算 0 人，空态诚实文案+来源标注完整（认证链路下 `crm_search_people_v1` 修复验证） |

console 错误收集：0 应用级错误。限制：AI 页在自动化桥接下间歇出现 WebView renderer 占用导致工具掉线（IDE Electron 桥接不稳定，非页面报错；用户接管登录与常规页面均正常），最终一次搜索在新标签完成；tcb CLI `fn invoke` 的 Cam 认证限制依旧（CLI 通道），但浏览器认证通道已完整覆盖真实云函数调用。

## 7. 发布

- 提交：`970cc1b`（PMC-20 收官：102 files +3770/-136——修复代码+21 migration/rollback+工具+6 文档）+ 档案回填提交（见 git log）。
- 标签：`release-20261010-2118`（提交 `970cc1b`）+ 档案回填标签（见 git log）。
- 部署范围：12 云函数（§4.2）+ person-360.js hosting + 3 DB 迁移（§4.1）。**未全量部署**；i18n.js/misc.js 为 WIP 未纳入提交。
- 三端核对：本地/GitHub/云端一致（commit、tag、函数清单）；迁移双目录哈希一致。
- release.ps1 因工作树含 WIP 文件未使用，按手动 git 流程发布并在本记录说明。

**2026-10-11 追加（FAB 修复 + Cam 回归）**：

- 代码发布：`bd3c9c5`（标签 `release-20261011-000403`，已推送，本地=GitHub）——并行工作会话整合发布，含 FAB aria 修复（本会话开发）、console 更多页 17 项旧版入口（双语）、person_360 时间线 customers 查询缺参线上故障修复（person-insights-service.js）、WP01 门夹具对齐、migration `20261010223000_pmc_restore_view_security_invoker`（+rollback；已应用，12 视图 reloptions 实测均为 security_invoker=true）。
- 云端一致性（本会话复核）：线上 shell.js/i18n.js/misc.js（pages/）SHA 与 `bd3c9c5` 全部一致；Cam 回归中 Person 360（#773）时间线正常渲染，与故障修复在线一致。
- 迁移双目录：并行会话漏同步外部镜像，本会话按双备份约定补齐（非破坏性复制），132/132 文件名与 SHA 一致。
- 本会话提交仅为档案（本节及 §6.5/§8、handoff、decisions、tasks 的追加记录），**云端产物未改变**；精确提交/标签见 git log 2026-10-11 档案回填提交。

## 8. 未验证项（如实登记）

| # | 项 | 原因 |
| --- | --- | --- |
| 1 | 平台层自动备份控制台核实 + 真实恢复演练 | 无隔离环境；本包恢复演练以只读 SQL 演练替代（§5），真实 PITR 演练须用户在云控制台执行 |
| 2 | ~~`fn invoke` 真实调用云函数（Cam 认证失败）~~ **已核销（2026-10-11）** | 浏览器 Cam 登录后端到端回归 8 页面全部真实数据、0 应用级错误（§6.5）；CLI `fn invoke` 通道限制依旧但不再构成未验证项 |
| 3 | AI 摘要/会前准备/对话策略按钮真实模型调用 | 避免产生真实模型成本；AI→云函数→RPC 链路已经 #/ai/search 模板端到端验证 |
| 4 | 复制电话/微信按钮真实剪贴板操作 | 王寻寻无电话/微信数据，按钮正确 disabled；逻辑已代码审查 |
| 5 | 基线遗留测试失败（§6.1 清单） | 0c511db 及更早遗留，修复须单独授权（规则 11） |
| 6 | ~~FAB aria-label 国际化~~ **已核销（2026-10-11）** | 用户批准修复并发布：`data-i18n-aria` 机制 + shell.js FAB，中英往返实测通过（§6.5） |
