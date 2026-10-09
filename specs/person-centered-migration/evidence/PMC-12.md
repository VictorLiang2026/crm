# PMC-12 证据（evidence/PMC-12）

## 1. 包概述

- 包名：PMC-12｜招募模块完成 Person 与招募资料分离
- 前置：PMC-11 已验收（2026-10-09 用户最终确认）
- 执行日期：2026-10-09
- 状态：**实施完成，待用户验收**（验收记录见 §14）

## 2. 影响说明（编码前已向用户说明并经四项裁决确认）

| # | 用户批准裁决 | 落地 |
| --- | --- | --- |
| ① | 视图读切换方案 = **Person 优先 + customers 回退**（`COALESCE(p.x, c.x)`） | migration `20261009091200`（§3） |
| ② | AI 复盘 B 类客户采纳改**预览确认**（不再静默自动建候选人） | admin.html `confirmRecruitConversion` 预览弹窗 + B 分支先 confirm 后 create（§3） |
| ③ | 旧增员表单保持「**必须先匹配客户**」 | create 仍强制 customer_id（R-ID1）；Person-only 建档继续走 person_360 identity command（kind=recruit，需 Selected Person），本包不加宽 |
| ④ | 死列 education/mbti **留置+登记**（不删不改） | 视图 education 改读 `COALESCE(p.education, c.education)`、mbti 保持 customers；登记 G-PMC12-1（§11） |

字段归属与重名字段含义核对（指令第 1 条）：

- **persons 的 education/occupation 等 = 人物客观事实** → 视图人物基础 7 列以 Person 为权威（customers 副本回退）。
- **recruit_candidates 的 mbti / personality_tags / motivation / concerns / career_plan / work_experience / family_situation = 招募评估结论**（业务域），不把招聘评估结论当作人物客观事实：不从 Person 覆盖、也不写入 persons。
- **annual_income / marital_status / hobbies / additional_info / source 维持客户域权威**（D3/D4/来源三义裁决），本包不动。

## 3. 变更清单（3 个云函数 + admin.html + 1 份 migration/rollback + 工具 + 测试）

| 文件 | 变更要点 |
| --- | --- |
| `cloudbase/migrations/20261009091200_pmc12_recruit_view_person_read.sql` | 两视图 CREATE OR REPLACE（列名/列序/类型/security_invoker/GRANT 全部不变，39 列/12 列）：主视图 **7 列**切 Person 优先——customer_name=`COALESCE(p.display_name, c.customer_name)`；gender/birthday/phone/occupation/education=`COALESCE(p.x, c.x)`；wx_account=`COALESCE(p.wechat, c.wx_account)`（异名映射）；trash 视图 **3 列**同规则（customer_name/phone/occupation）。annual_income/mbti/source/marital_status/hobbies/additional_info 保持 customers（客户域权威）。JOIN 保持 G-PMC11-2 LEFT JOIN 形态；无新授权（persons anon 只读复用 PMC-10 `20261008231500`） |
| `cloudbase/rollbacks/20261009091200_pmc12_recruit_view_person_read.sql` | 恢复 G-PMC11-2 形态（customer_name c 优先、其余 6 列直读 c），纯视图定义切换 |
| `cloudfunctions/recruit_candidates/index.js` | ① `candidateIdOf`：candidate_id 统一字符串校验，非法/超安全整数拒绝 `Invalid candidate ID`；get/update/remove/restore 以字符串精确命中；② create 返回 `id`/`person_id` **字符串化**（写入语义不变：仍强制 customer_id，R-ID1）；③ **existing_id 幂等**（同 customer_id 已有候选人时返回既有行，不重复建） |
| `cloudfunctions/recruit_score/index.js` | candidate_id 字符串透传（约 L104-108，R-ID2）；回写语义不变（仅 potential_score/potential_reason/updated_at） |
| `cloudfunctions/recruit_recommend/index.js` | candidate_id 字符串透传（约 L142-145，R-ID2）；零写入不变 |
| `admin.html` | ① `confirmRecruitConversion` 预览弹窗（约 L6642-6667）：展示将创建的候选人要素，人工确认后才调 create；② B 分支 `adoptParticipantAction`（约 L6692-6721）：AI 复盘 B 类客户采纳**先 confirm 后 create**，取消提示「已取消：未创建增员对象」，existing_id 幂等分支；③ 旧增员表单「必须先匹配客户」不动（裁决③） |
| `tools/migration-apply.cjs` | 适配 MCP 通道收紧：DDL 执行由 queryPgDatabase（已改只读白名单）改走 `managePgDatabase(action=execute, confirm=true)`；仅执行通道变更，无逻辑变化 |
| `tests/pmc/pmc12-recruit.test.cjs` | 新增：9 个纯离线隔离用例 T1-T9（§6.2） |

全部函数文件 `node --check` 通过；migration 已应用生产并 pg 复核。

## 4. 字段来源分界（验收口径）

| 来源 | 字段 |
| --- | --- |
| **Person（persons，经 recruit_candidates.person_id，视图 COALESCE 第一优先）** | customer_name（显示名）、gender、birthday、phone、wx_account（←p.wechat）、occupation、education |
| **customers（回退副本/保持权威）** | 上述 7 字段的回退副本；annual_income、mbti、source、marital_status、hobbies、additional_info（客户域权威不变） |
| **招募业务域（recruit_candidates）** | stage/stage_changed_at、potential_score/potential_reason、motivation/concerns、work_experience/family_situation、personality_tags/career_plan、next_action_date/next_action、activity_history、radar_image_*、winner_report_*、operator 等全部业务列（招募评估结论不当作人物客观事实） |
| **persons 写入** | 本包零 persons 写入；触发器 recruit_candidate_person_sync 行为不变（客户映射缺失时 legacy 自动建 Person） |

## 5. 部署（3 个云函数 + admin.html 静态 + 1 份 migration，均成功）

| 产物 | 结果 |
| --- | --- |
| recruit_candidates / recruit_score / recruit_recommend | 成功（`tools/tcb.ps1 fn code update --env-id crm-d1gkae8ddc930d151`） |
| admin.html（静态） | 成功：MCP manageHosting 上传 `crm/admin.html`，md5=`c9b3011adb8ffd5b92c496ddbce4a6ff`，accessUrl 可达 |
| migration `20261009091200` | 已应用生产并 pg 复核（tools/migration-apply.cjs → managePgDatabase execute） |

- 静态部署仅 admin.html 单文件（以 git 提交清单为准），未整目录上传。
- customers/persons 两表数据零修改；无新授权。

## 6. 验证证据

### 6.1 视图 before/after 快照（零差异）

- 快照：`tests/security/.results/pmc12-view-before.json` / `pmc12-view-after.json`（应用前后各采一次：主视图 15 行 × 39 列 + trash 3 行）——**字节级一致（SHA-256 同哈希 `F939A239…611955`）**，显示值零差异。
- 说明：零差异符合预期——PMC-11 实测已映射双源姓名冲突 0；已知单边差异（Person 783 / 客户 788 occupation）为一侧空值、COALESCE 结果不变；独立候选人 20 结构上改从 Person 取值，但其 Person 786 的 phone/occupation/education/wechat 当前均为空（pg 只读核实），显示值不变。当 Person 与 customers 副本出现值差异时，切换后以 Person 为准（设计行为）。

### 6.2 隔离测试（离线 fixture，9/9 全绿）

- 命令：`node --test tests/pmc/pmc12-recruit.test.cjs`（不触网络、不触线上、无模型费用）
- T1 migration：主视图 7 个身份列切 Person 优先 COALESCE（列别名与列序不变）
- T2 migration：回收站视图 3 列切换且 12 列契约不变
- T3 rollback：恢复 customers 优先定义
- T4 recruit_candidates get/update/remove/restore 以字符串 ID 精确命中（字符串 fixture 仅字符串可匹配）
- T5 非法 ID 拒绝（Invalid candidate ID，含超安全整数大 ID）
- T6 create 仍强制 customer_id + 返回字符串化 ID（R-ID1）
- T7 recruit_score/recruit_recommend candidate_id 字符串透传 + 缺失保留 legacy 错误
- T8 recruit_score 回写仅 potential_score/potential_reason/updated_at（评分语义不变）
- T9 admin.html：B 类客户采纳先 confirmRecruitConversion 预览确认、后 create；existing_id 幂等分支存在

### 6.3 受控浏览器生产回归（admin.html 真实通道，仅触碰虚构样本）

| 场景 | 结果 |
| --- | --- |
| S1 登录 | PASS |
| S2 招募列表 | PASS：统计卡合计 15 与迁移后视图行数一致、列表行渲染正常 |
| S3 增员评分（recruit_score，候选人「甲」） | PASS：AI 高潜评分 20 分+理由，回写链路正常（T8 契约的生产印证） |
| S4 独立候选人 20 话术生成（recruit_recommend） | PASS：内容含 Person 名（G-PMC11-2 修复后链路保持） |
| S6 客户列表（相邻回归） | PASS：16 行正常 |
| S7 招募回收站 | PASS：3 行正常（trash 视图切换后渲染正常） |
| S5 AI 复盘建议卡（B 类采纳预览确认路径） | **BLOCKED（非阻塞，登记 §9.1）**：当前库内无 B 类建议行（数据事实）+ 浏览器 IDE 超时；代码契约由 T9 覆盖 |

截图存档：`d:\Temp\trae\screenshots\`。浏览器删除/恢复按钮一律禁点（工作纪律）。

## 7. 实施中修复的真实缺陷

无（本包无计划外缺陷修复）。

## 8. 共享副本同步

- 本包未修改 `_shared/db.js`、`_shared/ai.js`、`person-service.js`、`context-engine.js`、`skill-registry.js`，无共享副本需同步。
- R11 漂移检测不受影响（本包不触碰共享副本）。

## 9. 未验证项（如实登记，不得视为通过）

1. **S5 AI 复盘 B 类采纳预览确认（confirmRecruitConversion）浏览器实测 BLOCKED**：库内当前无 B 类 AI 复盘建议行（数据事实，无现成测试样本）+ 浏览器 IDE 会话超时；代码契约由隔离测试 T9 覆盖（先 confirm 后 create、取消不建、existing_id 幂等）。留待后续有 B 类样本时实测/iPad 人工回归。
2. **招募软删除/恢复线上演练未做**：受控浏览器禁点删除按钮（工作纪律）；RPC crm_delete_batch recruit 分支本包**零改动**（开包盘点已核实不动 customers/persons），隔离测试 T4/T5 覆盖字符串 ID 命中与拒绝路径。
3. recruit_followups / recruit_goals / rcMap / funnel：盘点核实不涉及人物基础字段读写，本包零改动，仅随浏览器回归覆盖（S2/S7 正常）。

## 10. 盘点确认「不改」的对象

| 对象 | 核实结论 |
| --- | --- |
| 触发器 recruit_candidate_person_sync | 行为不变（legacy：客户映射缺失时自动建 Person） |
| RPC crm_delete_batch（recruit 分支） | 已核实不动 customers/persons（招募软删除不误伤 Person 其他角色）；本包零改动 |
| recruit_candidates create 强制 customer_id | 保持（R-ID1；裁决③：不为满足旧关联强制建 customers，也不放开无客户直接建候选人） |
| Person-only 建档通道 | person_360 identity command（kind=recruit，需 Selected Person）不变 |
| recruit_followups / recruit_goals / funnel / rcMap | 无人物基础字段读写，零改动 |
| admin.html 旧增员表单 | 「必须先匹配客户」不变（裁决③） |
| recruit_candidates 死列 education/mbti | 留置（裁决④；G-PMC12-1） |
| customers / persons 数据 | 零修改 |

## 11. 既有缺陷/观察项登记（按工作规则 11：只登记，不顺手修）

- **G-PMC12-1**：`recruit_candidates.education/mbti` 为死列（0 非空、无函数写入者；2026-10-09 开包盘点）。视图 education 现读 `COALESCE(p.education, c.education)`（c.education 恒空，实际生效 p.education），mbti 继续直读 customers.mbti。处置留置（裁决④），待 D5/D8 约束解除包统一处理；处置须单独授权。
- **G-PMC11-1**（沿用登记，未修）：ai_activity analyze top3/no_followup 清洗缺参与者 ID 白名单（见 evidence/PMC-11.md §11）。本包未触碰 ai_activity。

## 12. 不变项与红线核对

- 不删除/重命名任何已有对象；仅两视图 CREATE OR REPLACE 且列契约不变。
- 不为满足旧关联强制创建 customers 记录；不因旧 recruitment_priority 或备注内容自动创建候选人；B 类转化必须预览+人工确认（裁决②③）。
- 招募软删除/恢复不动 customers/persons（RPC 分支零改动，不误伤 Person 的客户、嘉宾等角色）。
- 已确认的历史跟进（recruit_followups）、阶段里程碑（recruit_goals/recruit_milestones）、附件引用（radar/winner report）、评分（potential_score/potential_reason）语义全部保留（T8）。
- 候选人缓存刷新：无独立缓存机制，视图读切换即时生效；旧页面兼容（admin.html 仅新增预览弹窗，列表/详情/回收站渲染回归 PASS）。
- 不拿真实客户数据测试（仅虚构样本）；Bigint ID 全程字符串化（R-ID1/R-ID2）。

## 13. 回滚条件

- 结构回滚：执行 `cloudbase/rollbacks/20261009091200_pmc12_recruit_view_person_read.sql`（两视图恢复 customers 优先定义，纯视图切换，无数据影响）。
- 代码回滚：`git revert` 本包提交 → 重新部署 recruit_candidates / recruit_score / recruit_recommend 三函数 + admin.html 静态。
- 回滚后行为：视图人物基础字段回到 customers 优先（c 值非空即用 c）；AI 复盘 B 类采纳回到静默自动建候选人（旧行为）。

## 14. 验收记录

- **验收日期**：2026-10-09
- **验收人**：用户确认（"好的，执行验收"）
- **验收结论**：**PASS_WITH_LIMITATIONS（通过，有限制项）**

### 14.1 验收依据

| 证据 | 结果 |
| --- | --- |
| 隔离测试复跑（本日） | 9/9 全绿稳定（duration 833ms；T1–T9 全 PASS） |
| 视图 before/after 快照零差异 | SHA-256 `F939A239…611955`（§6.1，已归档 `tests/security/.results/pmc12-view-*.json`） |
| 受控浏览器生产回归 | S1 登录 / S2 招募列表(15 行) / S3 增员评分 / S4 独立候选人 20 话术 / S6 客户列表(16 行) / S7 招募回收站(3 行) 全 PASS（§6.3） |
| regression 107/107 | 全绿（WP01 门槛） |
| WP01 门槛 | PASS_WITH_LIMITATIONS（catalog/guard-tests/regression/anonymous 全 PASS；login=MANUAL_LOGIN 非阻断） |

### 14.2 限制项（非阻塞，留待后续）

| # | 限制 | 处置 |
| --- | --- | --- |
| L1 | S5 AI 复盘 B 类采纳预览确认（confirmRecruitConversion）浏览器实测 BLOCKED | 库内当前无 B 类 AI 复盘建议行（数据事实）+ IDE 超时；代码契约由隔离测试 T9 覆盖（先 confirm 后 create、取消不建、existing_id 幂等）。留待有 B 类样本时实测 / iPad 人工回归 |
| L2 | 招募软删除/恢复线上演练未做 | 受控浏览器禁点删除按钮（工作纪律）；RPC crm_delete_batch recruit 分支本包零改动（盘点核实不动 customers/persons），隔离测试 T4/T5 覆盖字符串 ID 命中与拒绝路径 |
| L3 | G-PMC12-1 死列 education/mbti 留置 | 裁决④留置，待 D5/D8 约束解除包统一处理，须单独授权 |
| L4 | G-PMC11-1 沿用登记未修 | 既有缺陷、非本包引入；修复须单独授权 |

### 14.3 四项裁决落地确认

| # | 裁决 | 落地状态 |
| --- | --- | --- |
| ① | 视图读切换 = Person 优先 + customers 回退 | ✅ migration `20261009091200` 已应用，7 列 COALESCE，快照零差异 |
| ② | AI 复盘 B 类采纳改预览确认 | ✅ admin.html confirmRecruitConversion 弹窗 + B 分支先 confirm 后 create（T9 覆盖，L1 待实测） |
| ③ | 旧增员表单保持「必须先匹配客户」 | ✅ create 仍强制 customer_id（R-ID1，T6） |
| ④ | 死列 education/mbti 留置+登记 | ✅ education 读 COALESCE(p.x, c.x)、mbti 保持 customers；G-PMC12-1 已登记 |

### 14.4 验收口径

- 同一人物基础资料跨客户/招募一致：视图 7 列 Person 优先读，COALESCE 回退保证兼容；快照零差异证实当前数据一致。
- 招募阶段、目标进度、评分、附件、删除恢复：recruit_candidates/recruit_score/recruit_recommend 业务域字段语义全部保留（T4/T7/T8）；RPC recruit 分支零改动，软删除/恢复不误伤 Person 其他角色。
- Person-only 流程：person_360 identity command（kind=recruit，需 Selected Person）不变；独立候选人 20 经 G-PMC11-2 LEFT JOIN 修复后话术生成 PASS。

### 14.5 结论

**PMC-12 验收通过**（PASS_WITH_LIMITATIONS）。限制项均为非阻塞登记项，不阻断 PMC-13 开包。发布标签见 handoff.md §2。
