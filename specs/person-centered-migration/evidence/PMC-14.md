# PMC-14 证据（evidence/PMC-14）

## 1. 包概述

- 包名：PMC-14｜互动参与者和活动参与者统一人物身份（参与者身份归一）
- 前置：PMC-13 已验收（2026-10-09 用户确认 PASS，标签 release-20261009-151917）
- 执行日期：2026-10-09
- 状态：**实施完成，待用户验收**

## 2. 影响说明（编码前已向用户说明并经裁决确认）

### 2.1 两项裁决

| # | 用户批准裁决 | 落地 |
| --- | --- | --- |
| ① | 回填含软删行：7 行软删 customer 参与行的 canonical_person_id 一并回填 | migration 20261009180000（§3/§5） |
| ② | 展示名 Person 优先 + 快照保留：enrichParticipants 展示名经 canonical 关联取 persons.display_name；person_name 登记快照原字段保留不可变（D6） | activities enrichParticipants（§3） |

### 2.2 生产 UPDATE 专项批准

- 迁移 UPDATE 经 MCP 通道执行时被 guard 触发器正确拦截（canonical_person_id 变更仅 service_role 可写），按工作规则 12/3 向用户完整披露后获专项批准：精确映射（参与行 id 1,2→persons.id 1；id 3,5,7,9,11→persons.id 89）、影响范围（仅软删 customer 参与行 7 行、不动既有人工确认 2 行、无结构变更）、回滚方案（精确 id+预期值 rollback）。用户经 AskUserQuestion 答复**"确认执行（推荐）"**。
- 执行结果 AffectedRows=7；q10 后核对全符合预期（§6.4）。

### 2.3 活动流程影响口径（指令第 2/3/4 项落地边界）

- 邀请/报名/出席/缺席/取消等状态全部留在参与记录（status 列），语义不动；邀请不自动算作实际出席。
- 嘉宾角色（activity_speakers）与普通参与记录保持各自业务含义；嘉宾域 PMC-13 已完成，本包不动。
- 未识别邀请对象保持"身份待确认"（canonical IS NULL）：不创建虚假 Person、不猜测姓名填满关联。
- 多来源加入：活动 #2 经盘点核实为不同人物，无实际重复；本包零合并操作（合并参与记录须明确规则并经确认，不直接删除历史记录）。

## 3. 变更清单（1 个云函数 + 1 组迁移/回滚 + 测试与工具，无 admin.html 改动）

| 文件 | 变更要点 |
| --- | --- |
| `cloudbase/migrations/20261009180000_pmc14_participant_canonical_backfill.sql` | DO `$assert$` 断言块（锁定 19 行分布/7 行唯一映射/活跃 4 行 canonical 就位）+ 单条原子 UPDATE：仅对 person_type='customer' AND deleted_at IS NOT NULL 且快照名经 customers 精确唯一桥匹配的 7 行回填 canonical_person_id；不触碰既有人工确认 2 行。无结构变更 |
| `cloudbase/rollbacks/20261009180000_pmc14_participant_canonical_backfill.sql` | 按精确 id IN (1,2) AND canonical=1、id IN (3,5,7,9,11) AND canonical=89 置回 NULL，可逆且不动其他任何行 |
| `cloudfunctions/activities/index.js` | enrichParticipants 增强：① canonicalPersonId 字符串输出（R-ID1 int8 一律字符串）；② 展示名 Person 优先（有 canonical 关联时取 persons.display_name 覆盖展示，裁决②）；③ person_name 登记快照原字段保留（D6 不可变）；参与状态语义不动 |
| `tests/pmc/pmc14-participants.test.cjs` | 新增：11 个纯离线隔离用例（§6.2） |
| `tools/tcb-exec.cjs` | 新工具：node spawn 直连 @cloudbase/cli JS 入口执行 `tcb db execute --role service_role`（规避 .cmd spawn 禁令 CVE-2024-27980 与 PowerShell 5.1 参数引号吞噬；多语句须拆单文件执行） |
| `tools/pmc14-step1-assert.sql` / `pmc14-step2-update.sql` / `pmc14-step2-dryrun.sql` / `pmc14-q10-postcheck.sql` | 迁移拆分执行与前后核对 SQL（q10 七组计数：grp1/grp89/still_pending/alive_rows/alive_pid_no_canonical/alive_canonical/softdel_customer_canonical） |

全部函数文件 `node --check` 通过。静态文件零改动。persons 表零写入（只回填关联，不创建 Person）。

## 4. 字段来源分界（验收口径）

| 来源 | 字段 |
| --- | --- |
| **Person（persons，经 activity_participants.canonical_person_id）** | display_name（→展示名覆盖，裁决②）；canonical 关联为参与者人物身份权威 |
| **activity_participants（参与域，语义不动）** | person_type（customer/recruit/speaker）、person_id（**业务表主键**：customer→customers."Id"、recruit→candidates.id、speaker→activity_speakers.id，均**非** persons.id）、person_name（登记时快照，D6 不可变）、status（邀请/报名/出席/缺席/取消） |
| **persons 写入** | 本包零 persons 写入；5 行未识别邀请对象保持"身份待确认"（canonical IS NULL） |

## 5. 部署

| 产物 | 结果 |
| --- | --- |
| migration 20261009180000 | 已应用（`node tools/tcb-exec.cjs --role service_role`：step1 断言块 PASS → step2 UPDATE **AffectedRows=7**） |
| 迁移双备份 | migration SHA-256 `72BBA37C…`、rollback SHA-256 `9405B2E5…`，`D:\CRM\crm` 与 `C:\Users\victor\cloudbase` 两处一致 |
| activities 云函数 | 成功（`tools/deploy-function.ps1`：sync-shared 56 副本一致 + WP01 门 PASS，"[PASS] activities code uploaded after shared hash verification"） |
| 静态文件 | 零改动（admin.html 不变） |

## 6. 验证证据

### 6.1 只读盘点（q1–q9 关键数字）

- activity_participants 19 行：活跃 4（canonical 全就位、0 缺失）；软删 15（canonical 9 = 2 既有人工确认 + 7 本包回填；5 保持"身份待确认"）。
- ID 语义核实：person_id 按 person_type 分属业务表主键（非 persons.id）；快照名（person_name）证实 6 行 customer 语义；7 行软删 customer 行经 customers 精确唯一桥形成唯一映射（无二义）。
- 活动 #2 多来源加入核实为不同人物，无实际重复参与记录。
- activity_tasks 为硬删除语义、无参与者 canonical 读依赖；person_360/前端等读取方全量核实为正确语义，无需修改。

### 6.2 隔离测试（离线 fixture，11/11 全绿）

- 命令：`node --test tests/pmc/pmc14-participants.test.cjs`（不触网络、不触线上、无模型费用）
- 覆盖：参与者三层身份语义（person_id=业务表主键 + canonical + 快照名；T6/T8 断言 customer→customers.Id=56→"客户56名"、speaker→activity_speakers.id=88→"嘉宾88名"）、linkParticipant/addParticipant 行为、重复提交拒绝、多角色共存、未确认身份保留、canonicalPersonId 字符串化（R-ID1）、Person 优先展示与快照不可变（D6）。具体断言见测试文件。

### 6.3 全量测试复跑与回归

- tests/pmc 全量复跑：62 项中 59 PASS；3 失败 = G-PMC14-1（PMC-12 遗留 fixture 漂移，git stash 干净 HEAD 验证非 PMC-14 引入；登记不修，§11）。
- regression 隔离面 94 项 PASS。
- WP04 身份审计：PASS_WITH_EXCEPTIONS（failures=[]；exceptions 与已登记"身份待确认"行对应，详见 `tests/security/.results/wp04-audit.json`）。
- WP01 门槛：`node tests/wp01/run.cjs --assert-release` **PASS**，blockers=[]；catalog/audit 证据 --snapshot 格式（public 128 objects）。

### 6.4 迁移执行与生产后核对（service_role 通道）

- step1 断言块 PASS → step2 UPDATE AffectedRows=7。
- q10-postcheck 四份证据（`tests/security/.results/pmc14-q10-postcheck-{pre,post,post2,final}.json`）：**final 全符合预期**——grp1_ok=2、grp89_ok=5、still_pending=5、alive 行 4/0/1 与迁移前基线一致、softdel_customer_canonical=9。
- 失败尝试期间（CLI 传参丢弃导致 UPDATE 静默 0 行两次）q10 核对与基线完全一致，证实无部分写入。

## 7. 实施中修复的真实缺陷

- 无生产缺陷修复。测试 fixture 两处修正（T8 speaker 去重冲突、T6 addParticipant 重复冲突）属测试自身隔离性问题，随本包测试一并完成。
- 排障发现 CLI 传参缺陷（多行 SQL 被静默丢弃、PowerShell 5.1 引号吞噬）→ 新建 `tools/tcb-exec.cjs`（§3），属工具补齐非业务缺陷。

## 8. 共享副本同步

- 本包未修改 `_shared` 共享模块；activities 部署经 deploy-function.ps1 sync-shared 校验 56 副本一致。

## 9. 未验证项（如实登记，不得视为通过）

1. **受控浏览器生产深度回归未做**：admin.html 活动参与流程、活动统计、互动对象、人物时间线页面需登录，按 PMC-13 先例留待用户 iPad 人工验收；隔离面已覆盖（PMC-14 11/11 + regression 94 项 + WP04 + 生产 DB 核对）。
2. G-PMC14-1（pmc11 fixture 3 用例失败）登记未修（§11）。
3. 5 行软删参与行保持"身份待确认"（1 行 speaker + 4 行无 person_id 暂存行）：**设计行为**（批准方案：不建虚假 Person、不猜测姓名），非缺陷。

## 10. 盘点确认「不改」的对象

| 对象 | 核实结论 |
| --- | --- |
| person_360 | 参与者读取已核实为正确语义（canonical/快照），不改 |
| activity_tasks | PMC-10 已切换；硬删除语义、无参与者 canonical 读依赖，不改 |
| activity_reports / activity_topics | 盘点核实无参与者身份读取影响，不改 |
| admin.html | 活动参与读取链已核实正确语义，零改动 |
| crm/js/modules/console | 无活动参与者 canonical 依赖，不改 |
| 视图 | 迁移无结构变更，无依赖视图需重建 |
| 邀请/报名/出席/缺席/取消状态 | 留在参与记录 status 列，语义不动 |
| 嘉宾角色（activity_speakers） | 业务含义不动（PMC-13 已完成） |
| persons 表 | 零写入；不合并参与记录、不删除历史 |
| 既有人工确认 canonical 2 行 | 不触碰（UPDATE 范围仅 7 行软删 customer 行） |

## 11. 既有缺陷/观察项登记（按工作规则 11：只登记，不顺手修）

- **G-PMC14-1（本包新登记）**：`tests/pmc/pmc11-identity.test.cjs` 3 个 recruit 用例失败（recruit_recommend ×2、recruit_score ×1 "candidate not found"）。根因：PMC-12（522fbca）将 recruit_recommend/recruit_score 的 candidate_id String 化（R-ID1），pmc11 fixture 仍用数字 candidate_id，FakeQuery 严格相等不命中。git stash 干净 HEAD 验证为 PMC-12 遗留、非 PMC-14 引入；生产代码无恙（DB 侧字符串参数与 int8 比较正常）。修复=fixture 数字改字符串，属测试文件变更，须单独授权。
- G-PMC11-1（ai_activity analyze top3/no_followup 白名单）、G-PMC12-1（recruit_candidates 死列）沿用登记，未修。

## 12. 不变项与红线核对

- 不删除/重命名任何已有对象；无结构变更（仅数据回填）；public schema only，不涉及 `pr`/`pr_*`。
- D6 快照不可变：person_name 登记快照原字段保留；Person 优先仅作用于展示名。
- 不创建虚假 Person、不猜测姓名填满关联；5 行"身份待确认"按批准方案保留。
- 邀请不自动算作实际出席：状态语义留在参与记录。
- 不合并参与记录（活动 #2 核实为不同人物无重复；合并须明确规则并经确认）；不直接删除历史记录。
- 嘉宾角色与普通参与记录各自业务含义保持不变。
- int8 ID 一律字符串传输（R-ID1）。
- 不拿真实客户数据做破坏性测试（隔离 fixture；生产仅按专项批准回填 7 行软删行）。

## 13. 回滚条件

- 数据回滚：`cloudbase/rollbacks/20261009180000_pmc14_participant_canonical_backfill.sql`——按精确 id+预期值将 7 行 canonical 置回 NULL，不动既有人工确认 2 行与其他任何行。
- 代码回滚：`git revert` 本包提交 → 重新部署 activities 函数（回退 enrichParticipants 增强）。
- 无结构回滚（迁移无结构变更）。

## 14. 验收记录

- **验收日期**：2026-10-09
- **验收人**：用户 iPad 人工验收确认「都OK」
- **验收结论**：**PASS（通过）**

### 14.1 验收依据

| 证据 | 结果 |
| --- | --- |
| 隔离测试 | 11/11 全绿（`tests/pmc/pmc14-participants.test.cjs`） |
| migration 执行 | AffectedRows=7（step1 断言块 PASS → step2 UPDATE） |
| 生产后核对 | q10-final 全符合预期（grp1_ok=2、grp89_ok=5、still_pending=5、alive 4/0/1 不变、softdel_customer_canonical=9） |
| 全量测试复跑 | 62 项 59 PASS + 3 失败=G-PMC14-1（PMC-12 遗留，登记不修） |
| regression | 94 项 PASS |
| WP04 身份审计 | PASS_WITH_EXCEPTIONS（failures=[]） |
| WP01 门槛 | PASS（blockers=[]） |
| 受控浏览器生产深度回归 | 用户 iPad 实测全 OK（活动参与流程、活动统计、互动对象、人物时间线） |
| 三端一致性 | 两次发布均 `[PASS] Local / GitHub / cloud sources match` |

### 14.2 两项裁决落地确认

| # | 裁决 | 落地状态 |
| --- | --- | --- |
| ① | 回填含软删行：7 行软删 customer 参与行回填 canonical | ✅ migration 已应用 AffectedRows=7；q10-final 核对符合预期 |
| ② | Person 优先+快照保留：展示名经 canonical 取 persons.display_name；person_name 快照不可变 | ✅ enrichParticipants 已部署（canonicalPersonId 字符串输出+Person 优先展示+D6 快照保留） |

### 14.3 发布记录

- 主发布：提交 `d081a64`（24 files, +880/-26，代码+档案合一）；标签 `release-20261009-203048`；GitHub master 推送成功（`5fca6c1..d081a64`）。
- 档案补录：提交 `f639b88`（2 files，登记发布记录与回滚哈希；云端产物未改变）；标签 `release-20261009-205135`。
- 两次发布均三端一致 PASS（28 函数 170 文件一致、线上 admin.html SHA 一致、50 资产一致）。
- 部署范围：activities 1 个云函数（sync-shared 56 副本一致 + WP01 门 PASS 后上传）+ migration 20261009180000（已应用）；静态文件零改动。

### 14.4 验收限制项（非阻塞）

| # | 限制 | 处置 |
| --- | --- | --- |
| L1 | 受控浏览器生产深度回归由用户 iPad 人工验收（非受控通道） | 用户确认全 OK，关闭未验证项第 1 条 |
| L2 | G-PMC14-1（pmc11 fixture 3 用例失败）登记未修 | PMC-12 遗留 fixture 漂移，修复须单独授权 |
| L3 | 5 行软删参与行保持"身份待确认" | 批准方案的设计行为，非缺陷 |

### 14.5 结论

**PMC-14 验收通过（PASS）**。参与者身份归一落地完成：三层身份模型（person_type+业务表主键 person_id／canonical_person_id／person_name 快照）经盘点证实；7 行软删 customer 参与行经专项批准回填 canonical；activities enrichParticipants Person 优先展示生效；未识别邀请对象按批准方案保留"身份待确认"；邀请不自动算作实际出席；多来源加入核实为不同人物无实际重复。G-PMC14-1 登记未修（非阻塞）。按约定发布后停止，等待 PMC-15 指令。
