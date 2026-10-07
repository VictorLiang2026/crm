# Evidence：PMC-02（目标数据模型与接口契约设计）

执行日期：2026-10-07。执行工具：Trae。基线：本地=GitHub `master` @ `86480ab`（PMC-01 补录提交），补打标签 `release-20261007-2217` 并推送后开包。工作树仅本包文档改动。

## 1. 设计产出

- 新建 [data-model.md](../data-model.md)：主实体与 ID 契约（§1）、字段归属字典（§2）、三层资料与快照（§3）、角色基数与软删除（§4）、customers.person_id 关联与 legacy_customer_id 退出（§5）、受影响 action 接口契约（§6）、切换/部署/回滚（§7）、需用户决策清单 D1–D11（§8）。
- 性质：纯设计文档包，**未实施任何迁移**、未改业务代码、未改数据库对象、未部署云端业务产物。

## 2. 实测记录（tools/pg-readonly.cjs，只读 SELECT，2026-10-07）

| 查询 | 关键结果 |
| --- | --- |
| information_schema.columns（persons/customers） | persons 16 列：id=**bigint**、display_name/name_key NOT NULL、legacy_customer_id=int4；customers 29 列："Id"=**integer**、customer_name text NOT NULL、annual_income=integer、household_income=text、profile=jsonb、delete_batch_id=uuid |
| information_schema.columns（招募/嘉宾/参与/关系/互动/机会/角色/身份命令/客户子表） | recruit_candidates 38 列（person_id bigint **NOT NULL**、customer_id 可空）；activity_speakers 23 列（person_id 可空、customer_id bigint 无 FK、recruit_candidate_id）；activity_participants 14 列（person_id 无 FK、canonical_person_id 有 FK）；relationships 14 列；interactions 13 列（person_id NOT NULL）；opportunities 15 列（customer_id=integer、person_id=bigint 可空）；person_roles 6 列；person_identity_commands 12 列（uuid PK）；followups."Id"/photos.id=integer，其余子表 id=bigint、customer_id 混合 int4/bigint |
| pg_constraint（PK/UNIQUE，67 行） | customers：PK("Id")、UNIQUE("Id")、**UNIQUE(customer_name)=客户列表_姓名_key**；persons：PK(id)、UNIQUE(legacy_customer_id)、UNIQUE(legacy_customer_id,id)；**persons 无姓名唯一约束**（name_key 非唯一）；person_roles：UNIQUE(person_id, role) |
| pg_sequences | persons_id_seq=787、recruit_candidates_id_seq=20、opportunities_id_seq=11、interactions_id_seq=13（均远低于 2^53；customers_Id_seq 不在结果中，int4 序列由索引/触发器维护或命名不同，不影响结论） |
| person_roles 分布 | customer 779（legacy_backfill 776+manual 3）、recruit 14（12+2）、speaker 4（3+1）、participant 2（1+1）；**无 deleted_at 列**（角色表不软删） |
| U1 补查（3 个无 Person 客户，脱敏） | #786（2026-09-28 建，1 条 followup，姓名 6 字符无数字）；#789（2026-10-04 建，无子记录，姓名 3 字符）；#790（2026-10-04 建，1 条 followup，姓名 3 字符）；**均未软删、无嘉宾/机会/招募/礼品/照片/OCR 关联**。根因判断：legacy `customers.create` 不创建/关联 Person |

## 3. 代码核查记录（本地源码）

| 事实 | 证据 |
| --- | --- |
| Person 链以字符串传输 bigint ID | `cloudfunctions/person_360/index.js` L247 `personId: String(person.id)`、L234 `String(item.id)` Map 键、L58/L91 `String()` 归一 |
| name_key 归一化逻辑 | `cloudfunctions/_shared/person-service.js` L54 `nameKey = normalizeWhitespace(baseName).toLowerCase()`；L82 检索条件含 `deleted_at: 'is.null'`（软删排除） |
| legacy 客户域用 parseInt 解析 int4 ID（可接受） | `cloudfunctions/customers/index.js` L71/L119/L142/L229-230 |
| **legacy 招募域对 bigint 主键用 parseInt（前瞻精度风险，列入实施包修正）** | `cloudfunctions/recruit_candidates/index.js` L93/L130/L155/L224-225 |

## 4. 决策与批准状态

- D1–D11 集中登记于 data-model.md §8 与 [decisions.md](../decisions.md)；**全部待用户批准**。设计未确认前不进入依赖该设计的实施包（execution-contract A、用户 PMC-02 指令验收条款）。

## 5. 发布记录

- 主发布：提交 `cdc1cf9`，标签 `release-20261007-223725`（原子推送；发布前 WP01 gate PASS、发布前三端云端核验 28 函数 170 文件 / 56 共享副本 / 50 静态资产全绿，发布后 sync-check 全绿）。
- WP01 门槛细节：releaseGate=PASS_WITH_LIMITATIONS、blockers=[]；catalog 784 项检查 PASS（47 表/12 视图/36 序列/33 例程）；回归 107 PASS / 0 FAIL / 5 SKIP；anonymous 探针 59/59；login=MANUAL_LOGIN（非阻断，已知）；service-runtime/live-writes/mobile=UNVERIFIED（如实声明，本包不涉及）。
- 云端业务产物：**未改变**（纯文档包；静态页面与云函数均无部署——sync-check 云端核验即一致性证明）。
- 本补录提交：见 tasks.md PMC-02 结果行与 Git 标签记录（发布记录回填）。
