# PMC-03 证据与执行记录

状态：**待回填**（产物已落盘，待执行测试与发布后回填 §7）。本文件记录 PMC-03 执行状态、测试结果、限制声明与未验证项。基线：`86480ab` / `release-20261007-2217`。

---

## 1. 产物清单

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `specs/person-centered-migration/pmc-03-verification.md` | 设计文档（测试映射+核对项+风险用例+恢复 runbook+隔离限制+WP01 核实） | 已落盘 |
| `tools/migration-check.sql` | 只读 WITH→snapshot JSON（counts/mappings/orphans/roles/softdelete_cross/nulls/pagination，无 PII） | 已落盘 |
| `tools/migration-check.cjs` | 经 pg-readonly 通道执行 SQL+评估 failures+写报告 | 已落盘 |
| `tests/pmc/risk-cases.test.cjs` | R1–R10+R-ID1 离线契约测试 | 已落盘 |
| `tests/pmc/shared-copy-drift.test.cjs` | R11 文件哈希漂移检测 | 已落盘 |
| `tests/pmc/README.md` | 运行方法+覆盖矩阵+限制声明 | 已落盘 |
| `evidence/PMC-03.md` | 本文件 | 已落盘，§7 待回填 |

---

## 2. 只读核对工具（migration-check）

**执行方法**：

```bash
node tools/migration-check.cjs --out tests/security/.results/pmc03-migration-before.json
```

**报告 schema**：`{ version, schema, environment, observedAt, counts, mappings, orphans, roles, softdelete_cross, nulls, pagination, failures, status, blockerCount }`

**评估阈值**（固定，不回填线上结果）：
- `orphans.*` > 0 → blocker
- `roles.duplicate_role_rows` > 0 → blocker
- `mappings.customer_person_unique_violations` > 0 → blocker
- `softdelete_cross.*` 仅记录，不阻塞（目标语义允许，D10）

**执行结果**（2026-10-08 实测）：
- 迁移前快照：`tests/security/.results/pmc03-migration-before.json`
- 迁移后快照：N/A（PMC-03 为基线工具，迁移后快照由实施包执行时产生）
- status：**PASS**
- blockerCount：**0**
- 关键数据：persons 784（3 软删）/customers 783（1 软删）/recruit_candidates 18/relationships 0/opportunities 9；legacy_matched=779，customers_without_person=3（与 PMC-01 U1 一致）；orphans 全 0；roles.duplicate_role_rows=0；softdelete_cross 全 0；persons.phone 空值 782（仅 2 条非空，预期基线）
- SQL 修订记录：①interactions 表无 `deleted_at` 列（PMC-01 影响矩阵已记；本工具从 counts 移除该行，total 通过 orphans.interaction_person_id 仍可见）；②customers.person_id 列尚未实施（PMC-02 §5.1 设计目标，需实施包 migration）→ 用 NULL 占位，迁移后快照由实施包修订回真实查询

---

## 3. 风险用例（R1–R11）

**执行方法**：

```bash
node --test tests/pmc/risk-cases.test.cjs tests/pmc/shared-copy-drift.test.cjs
```

**执行结果**（2026-10-08 实测）：
- 总用例数：14（R1–R10 + R-ID1 = 11 个 + R11 含 3 个子测试）
- 通过：**14**
- 失败：0
- 跳过：0
- 输出摘要：`node --test` 退出 0；duration 667ms

**R11 漂移检测结果**（2026-10-08 实测）：
- `_shared/person-service.js` SHA-256：`f287fceed0c8463f1a6d0218973d2cddea8c6c8c1cc969725500ae620e115302`
- `person_360/person-service.js` SHA-256：`f287fceed0c8463f1a6d0218973d2cddea8c6c8c1cc969725500ae620e115302`
- `assistant/person-service.js` SHA-256：`f287fceed0c8463f1a6d0218973d2cddea8c6c8c1cc969725500ae620e115302`
- 是否漂移：**否**（三份一致；1 个 distinct hash group）
- 处置：当前无漂移；扩展 `sync-shared.cjs` MODULES 列入 PMC-04+（单独授权），纳入常规同步追踪以防未来漂移

---

## 4. 恢复 runbook（未演练）

四类恢复区分（详见 `pmc-03-verification.md` §4）：

| 类型 | 触发 | 操作 | 增量数据保留 |
| --- | --- | --- | --- |
| 代码恢复 | 函数行为回归失败 | `tcb fn code update` 回退 + git revert | 新写入天然落库 |
| 结构回滚 | migration 引发视图/触发器问题 | 执行 rollback SQL（不删已回填数据） | 已回填 person_id 保留 |
| 数据恢复 | 对账差异超阈值 / 误删 | 从双备份恢复；不对真实数据演练 | 增量由对账清单覆盖 |
| 向前修复 | 漂移但回滚成本高 | 修正 migration+函数+视图重建 | 增量天然保留 |

**未验证项**（本包不演练）：
- 结构回滚（无隔离环境）
- 数据恢复（不对真实数据做删除演练）
- 阶段 3 视图回退脚本（视图重建包提供）

**不声称"可安全回滚"**：恢复能力未演练前，本文件明确标"未验证"。

---

## 5. 隔离限制声明

- 不新建环境：沿用生产 CloudBase + 本地仓库。
- 不对真实数据执行删除/恢复演练：R2/R9 用 fixture 离线契约测试。
- 测试样本：复用 `tests/regression/fixtures.cjs` 已登记虚构样本；本包不新增种子。
- 只读核对：`migration-check.sql` 经 `pg-readonly.cjs`，客户端拒绝 DDL/DML/多语句。
- WP01 门槛不改：本包不接入 release gate。

---

## 6. WP01 门槛核实

| 项 | 现状 | PMC-03 是否修改 |
| --- | --- | --- |
| catalog.sql 经 queryPgDatabase → wp01-catalog.json | 现有 | 否 |
| audit.sql → wp04-audit.json | 现有 | 否 |
| `npm run test:wp01` | 现有 | 否 |
| `npm run test:wp01:login`（MANUAL_LOGIN 非阻断） | 现有 | 否 |
| `npm run check:release-gate` | 现有 | 否 |
| 报告一小时有效期 | 现有 | 否 |

**缺口登记**（非阻塞，不修改门槛跳过）：
- G-PMC03-1：WP01 门槛不含迁移核对项；PMC-03 提供独立 `migration-check.cjs` 补充证据。
- G-PMC03-2：WP01 不含 person-service.js 副本漂移检测；PMC-03 提供 `shared-copy-drift.test.cjs`。
- G-PMC03-3：无隔离环境用于结构回滚/数据恢复演练；PMC-03 仅提供 runbook。

---

## 7. 发布与三端核对（待回填）

**发布命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "PMC-03 迁移验证及恢复基线：测试映射+只读核对工具+11风险用例+恢复runbook；纯测试/工具/文档包，不切换业务行为、不迁移真实数据、云端业务产物未改变"
```

**回填项**（2026-10-08 实测）：
- 主提交 SHA：`219482bb38d18eff78f072f39d8c4b9144b377c1`（`219482b`）
- 发布标签（时间戳）：`release-20261008-110225`
- 是否首提交（需 semver）：否（当前基线 v2.1.0 已设于 WP2，本包不递进 semver）
- GitHub push 结果：`0a414e0..219482b HEAD -> master`；`[new tag] release-20261008-110225`
- 云端部署范围：**无业务产物部署**（纯测试/工具/文档包；sync-check 仅做源码核对，未触发 tcb fn code update 或 hosting deploy）
- sync-check.ps1 结果：全绿——56 份共享副本（db.js `124c6ac6…` / ai.js `6fa94a41…`）一致；50 个静态资源（2 HTML + 48 console 模块链）一致；28 个函数 170 个源/配置文件一致；GitHub master 与 release tags 一致 HEAD `219482b`；云端 admin.html HTTP 200 + SHA-256 一致
- 三端一致性（本地/GitHub/云端 admin.html）：**全部一致**

**验收对照**：
- 可重复执行方法：是（`node --test tests/pmc/*.cjs` + `node tools/migration-check.cjs --out <path>`）
- 预期结果：是（pmc-03-verification.md §1–§6）
- 当前结果：14/14 测试通过；migration-check `status=PASS blockers=0`；R11 三份 person-service.js 副本 SHA-256 一致无漂移；WP01 门槛 `releaseGate=PASS_WITH_LIMITATIONS`（107 PASS/0 FAIL/5 SKIP，blockers=[]，open 项=login/service-runtime/live-writes/mobile 均为非阻断 UNVERIFIED/MANUAL_LOGIN）
- 证据位置：本文件 + `tests/security/.results/pmc03-migration-before.json` + `tests/security/.results/wp01-report.json`
- 原有故障与新增故障可区分：是（PMC-03 测试独立运行，不接入 release gate；WP01 重采中遇到的 `account.password`/`customers.pagination` 间歇性 puppeteer 超时为先前已存在问题，与本包无关，第三次运行已通过）

**WP01 重采记录**：本次发布前需重采 catalog.sql/audit.sql 经 `pg-readonly.cjs --snapshot` 刷新 `wp01-catalog.json`/`wp04-audit.json`，再跑 `npm run test:wp01`。前两次运行 `account.password`、`customers.pagination` 间歇性超时 FAIL（puppeteer DOM 加载问题，非 PMC-03 引入），第三次 `{"PASS":107,"FAIL":0,"SKIP":5}` 通过。

---

## 8. 不硬编码通过声明

- R1–R10 断言基于 data-model.md 接口契约 C1–C9 与 D1–D11（行为预期），不读线上结果回填。
- R11 基于文件 SHA-256 比较，不预设三份一致（漂移即报）。
- migration-check.cjs failures 评估基于固定阈值，不依据当前线上计数回填通过。
- 恢复能力未演练前，本文件 §4 明确标"未验证"，不声称"可安全回滚"。
