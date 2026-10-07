# PMC-01 执行档案：Person 中心化迁移全量影响盘点

- 执行日期：2026-10-07
- 执行工具：Trae（Kimi-K3 agent）
- 范围：只读审计 + 文档更新；**不修改业务代码、表结构或业务数据**
- 前置条件：PMC-00 已验收（基线 `3760891`，三端一致）
- 结果：盘点完成；全部 6 项指令任务已完成；待文档发布验收

---

## 一、基线核实（execution-contract B）

| 端 | 核实结果 |
| --- | --- |
| 本地 | `master` @ `3760891`，`git status` 干净（PMC-01 开包前）；盘点期间仅新增 `tests/security/.results/` 下的临时证据文件（gitignored）和 `specs/person-centered-migration/` 下的文档修改 |
| GitHub | `origin/master` @ `3760891`，fetch 后一致 |
| 云端 | `sync-check.ps1` 全绿（28 函数 170 文件、50 静态资产、56 共享副本、admin.html SHA-256 一致） |
| 数据库迁移 | 本地 82 份；外部双备份 82/82 哈希一致 |

---

## 二、任务执行记录（按用户指令 1–6）

### 任务 1：数据库对象重新核实（public schema）

工具：`tools/pg-readonly.cjs`（单条 SELECT/WITH，拒绝 DDL/DML/多语句）+ Node 本地扫描脚本。

| 类别 | 数量 | 备注 |
| --- | --- | --- |
| 基表 | 47 | 全部启用 RLS；41 表单策略，6 表多策略 |
| 视图 | 12 | 全部 `security_invoker=true` |
| 数据库函数 | 33 | 含 3 个 `SECURITY DEFINER` |
| 序列 | 36 | — |
| 外键 | 66 | 含 RESTRICT/CASCADE/SET NULL |
| 触发器 | 91 | 含 not-null 检查、guard、sync 等 |

**旧基线修正**：design.md 中 2026-10-02 的"37 表、10 视图"已过时，以本次 47 表/12 视图/33 函数为准，旧记录保留备查并标注"已被取代"。

**身份字段重复统计（脱敏汇总）**：

| 表 | 身份字段数 | 有 person_id | 有 customer_id | 有 deleted_at |
| --- | --- | --- | --- | --- |
| persons | 9 | — | — | 1 |
| customers | 10 | 0 | — | 1 |
| activity_speakers | 5 | 1 | 1 | 1 |
| recruit_candidates | 4 | 1 | 1 | 1 |
| opportunities | 1 | 1 | 1 | 1 |
| photos | 2 | 0 | 1 | 1 |
| gifts | 2 | 0 | 1 | 1 |
| followups | 1 | 0 | 1 | 1 |
| policy_review_reports | 1 | 0 | 1 | 1 |
| ai_recommendations | 1 | 0 | 1 | 0 |
| ocr_records | 1 | 0 | 1 | 1 |
| activity_participants | 1 | 1 | 0 | 1 |
| products | 1 | 0 | 1 | 1 |

**Person 覆盖与一致性**：

| 指标 | 数值 |
| --- | --- |
| persons 总行数 | 784（含 3 条软删除） |
| persons.legacy_customer_id 非空 | 780（99.5% 已映射） |
| customers 总行数 | 783（含 1 条软删除） |
| customers 无对应 Person | **3**（未知项 U1） |
| person_alive_customer_deleted | 0 |
| person_deleted_customer_alive | 0 |
| 各子表孤儿引用（customer_id / person_id） | **全部 0** |

> 所有脱敏统计证据位于 `tests/security/.results/`（gitignored），文件名前缀 `pmc01-*`。

### 任务 2：函数清单三方交叉盘点

| 来源 | 数量 | 范围 |
| --- | --- | --- |
| 云端函数（`tcb fn list`） | 54 | 28 CRM + 26 `pr_*`（`pr_*` 禁入） |
| 本地 `cloudfunctions/` 目录 | 28 + `_shared` | 与云端 CRM 函数一一对应 |
| `cloudbaserc.json` | 28 | 与本地一致 |

结论：三方交叉一致；无未登记的 CRM 函数，无遗漏本地目录。

### 任务 3：逐函数提取 action 清单（28 函数 × action 矩阵）

自动化扫描：
- `tests/security/.results/pmc01-scan-functions.js`：遍历 28 函数目录全部 `.js`，提取 case 标签/actions、tables、rpcCalls、writeOps、envKeys → `pmc01-function-scan.json`
- `tests/security/.results/pmc01-scan-frontend.js`：扫描 `admin.html` 与 console 模块的 `callFn` 调用 → 提取前端入口

**person_360 共 50 个 action**，全部提取；主要 RPC 调用清单：`person_identity_preview_v1`/`execute_v1`、`quick_capture_v2_plan_v1`/`command_v1`/`commit`、`crm_opportunity_preview_v1`/`execute_v1`、`crm_work_item_preview_v1`/`execute_v1`、`crm_activity_review_preview_v1`/`execute_v1`。

矩阵按 6 域组织（客户域/Person 域/活动域/招募域/机会域/AI 域），每行标状态：**需修改 / 仅回归 / 已核实无影响 / 未知**。详见 [impact-matrix.md](../impact-matrix.md) 第六节。

### 任务 4：完整调用链核查（5 专项）

| 专项 | 结论 | 状态 | 关键位置 |
| --- | --- | --- | --- |
| 4.1 嘉宾创建直接查/建 customers | 已核实：`activity_speakers` create 按姓名查 `customers`，无匹配则自动 insert 建档 | **需修改** | `cloudfunctions/activity_speakers/index.js` L119–148 |
| 4.2 OCR 删除后前端快照恢复 | 已核实：`ocr_records.remove` 返回 `customer_snapshot`；前端调 `customers.update` 恢复 | **需修改** | `cloudfunctions/ocr_records/index.js` L73–82；`crm/admin.html` L3372–3383 |
| 4.3 漏斗/招募经视图间接读客户字段 | 已核实：`funnel_insight` 读 `v_funnel_stats`（JOIN customers）；`recruit_candidates` 列表读 `v_recruit_candidates`（JOIN customers） | **需修改** | `cloudbase/migrations/20260910120000_funnel_stats_view.sql`；`20260905130000_recruit_view_files.sql` |
| 4.4 Quick Capture / 新旧 Person 服务写入 | 已核实：Quick Capture V2 只读 persons，写入经 RPC；Person 身份预览/执行经 RPC `person_identity_preview_v1`/`execute_v1` | **已核实无影响** | `assistant/quick-capture-v2-service.js`；`person_360/index.js` L277–340 |
| 4.5 共享模块副本遗漏 | 已核实：`_shared/db.js` + `ai.js` 在 28 函数目录各持副本（56 份）；`sync-check` 验证全部一致 | **已核实无影响** | 母本 `cloudfunctions/_shared/` |

### 任务 5：impact-matrix 13 列结构

已完成，写入 [impact-matrix.md](../impact-matrix.md) PMC-01 节，包含：
1. 数据库对象清单（47 表/12 视图/33 函数/36 序列/66 FK/91 触发器）
2. 身份字段重复统计表
3. Person 覆盖统计表
4. 外键约束分析（指向 persons.id 的 19 条 / 指向 customers."Id" 的 8 条 / 复合 FK / 无 FK 列）
5. 视图依赖分析（12 视图数据来源与身份字段来源）
6. 函数 × action 矩阵（6 域，逐 action 标状态）
7. 5 专项调用链核查结果
8. 前端入口清单（Legacy + Console）
9. 未知项 U1–U8

### 任务 6：文档现状更新

- **design.md**：更新"视图与权限要点"为 2026-10-07 实测基线（47 表/12 视图/33 函数），保留 2026-10-02 旧记录并标注"已被取代"；修正 G4 过时记录（console.html 爬虫覆盖）；逐包设计表登记 PMC-01。
- **requirements.md**：无需结构改动（通用验收底线已覆盖本次盘点范围）。
- **impact-matrix.md**：全量重写 PMC-01 节（见任务 5）。

---

## 三、未知项与补查任务（U1–U8）

| # | 未知项 | 影响 | 补查任务 | 优先级 |
| --- | --- | --- | --- | --- |
| U1 | 3 个 customers 无对应 Person 的具体原因 | 阻塞 Person 收敛完整性验证 | 查询这 3 个客户的 Id/姓名/创建时间，判断是否为已删除/测试数据 | 高 |
| U2 | `activity_participants.person_id` 无 FK 约束的原因 | 可能导致孤儿参与者记录 | 检查是否为历史遗留，是否需要补 FK | 中 |
| U3 | `activity_speakers.customer_id` 无 FK 约束的原因 | 可能导致孤儿嘉宾记录 | 同上 | 中 |
| U4 | `persons.legacy_customer_id` 自引用 FK 的语义 | 需确认是否允许 NULL | 检查约束定义是否允许 NULL | 低 |
| U5 | `opportunities` 双 FK（customer_id+person_id → persons）的迁移计划 | 阻塞机会域 Person 化 | 确认何时可以移除 customer_id 列 | 高 |
| U6 | `recruit_candidates` 双 FK 同上 | 阻塞招募域 Person 化 | 同上 | 高 |
| U7 | `ai_recommendations` 无 deleted_at 列 | 与其他表软删除不一致 | 确认是否需要补 deleted_at | 低 |
| U8 | `ai_tasks`/`ai_runs`/`ai_results` 无 deleted_at 列 | 同上 | 同上 | 低 |

**阻塞项说明**：U1（3 个 customers 无 Person）和 U5/U6（双 FK 过渡期）直接影响后续 Person 收敛设计，必须在 PMC-02 之前解决。U2/U3 建议在设计阶段一并评估。

---

## 四、关键发现（不影响当前包，供后续包参考）

1. **零孤儿引用、零软删除不一致**：所有子表的 customer_id / person_id 外键均指向有效记录；person_alive_customer_deleted = 0、person_deleted_customer_alive = 0。数据一致性良好。
2. **共享模块 56 副本一致**：当前 `_shared/db.js` 和 `ai.js` 在 28 函数目录的副本全部与母本一致（SHA-256 匹配）。未来修改须经 `npm run build:shared` + `check:shared` 并逐函数部署。
3. **interactions RLS 限制**：仅 `service_role` 可 SELECT，云函数必须经 `person_360`（`CRM_PERSON360_DB_API_KEY`）委托查询；匿名 `rdb()` 直查会 `permission denied`。
4. **ai_recommendations / ai_tasks / ai_runs / ai_results 无 deleted_at**：与其他业务表软删除语义不一致，后续如需统一回收站需补列。
5. **旧文档基线过时**：2026-10-02 的"37 表 10 视图"基线已因后续 WP 实施扩展为 47 表 12 视图；本次已更新 design.md 并保留旧记录备查。

---

## 五、发布计划

- **性质**：纯文档包——仅更新 `specs/person-centered-migration/` 下 4 个文档文件（`impact-matrix.md`、`design.md`、`tasks.md`、`handoff.md`、`README.md`）+ 新建 `evidence/PMC-01.md`。
- **云端产物**：不改变（无页面/函数部署；文档不部署到静态托管）。
- **发布前门槛**：
  1. `npm run test:wp01` WP01 gate PASS（证据 1 小时时效可能已过期，按需刷新）。
  2. `sync-check.ps1` 全绿。
- **标签**：`release-20261007-HHMM`（当日本包时序标签）+ 当日首次提交补 semver（当前基线 v2.1.0，WP2 首设）。

---

## 六、验收检查清单（执行约定 L）

- [x] 核心读写链路无未解释入口：28 函数 × action 矩阵已逐项覆盖，全部有状态标记和证据。
- [x] 未知项有具体补查任务：U1–U8 已列出，含影响评估和优先级。
- [x] 影响后续设计的未知项已识别：U1（3 个无 Person 的 customers）、U5/U6（双 FK 过渡期）标记为高优先级，必须先解决。
- [x] 旧文档与当前事实冲突已处理：design.md 已更新 47 表/12 视图基线，旧记录保留并标注"已被取代"。
- [x] 发布执行：WP01 gate PASS → `release.ps1` 发布成功 → 标签 `release-20261007-193230`（提交 `42787ff`）→ 三端核对一致。

### 发布后核对（2026-10-07 实测）

```
git status --short          → 干净
git rev-parse HEAD          → 42787ff5dbc9202dd15882f6ffe12d09d2f8c44a
git ls-remote origin master → 42787ff5dbc9202dd15882f6ffe12d09d2f8c44a
git tag --points-at HEAD    → release-20261007-193230
```

发布前 sync-check：28 函数 170 文件一致、50 静态资产一致、56 共享副本一致、admin.html SHA-256 一致。
发布后 sync-check：同上，全绿。

---

## 七、恢复方案

- 本包回退：`git revert` 文档提交（或按标签检出前一基线 `3760891`）→ 推送；无云端产物、无数据库对象，无需数据回滚。
- 临时证据文件位于 `tests/security/.results/`（gitignored），可按需清理。
