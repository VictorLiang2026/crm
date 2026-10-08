# PMC-04 证据（evidence/PMC-04）

状态：**待用户验收**。基线：`313e23c` / `release-20261008-115430`；实测日期 2026-10-08。

---

## 1. 产物清单

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `specs/person-centered-migration/pmc-04-confirmation.md` | 带版本约束的确认清单（五分类+候选+差异+建议+阻断声明） | 已落盘 |
| `tools/conflict-check.sql` | 第一轮只读冲突检测 SQL（缺失/一对多/多对一/孤立/软删除/字段冲突/同名不同人） | 已落盘 |
| `tools/conflict-check-detail.sql` | 第二轮深查 SQL（无 legacy Person 角色引用+同名组 phone/wechat 哈希比对） | 已落盘 |
| `tests/security/.results/pmc04-conflict-check.json` | 第一轮快照 | 已生成 |
| `tests/security/.results/pmc04-conflict-detail.json` | 第二轮快照 | 已生成 |
| `evidence/PMC-04.md` | 本文件 | 已落盘，§7 待回填 |

---

## 2. 冲突检测实测结果

**执行方法**：

```bash
node tools/pg-readonly.cjs --file tools/conflict-check.sql --snapshot --out tests/security/.results/pmc04-conflict-check.json
node tools/pg-readonly.cjs --file tools/conflict-check-detail.sql --snapshot --out tests/security/.results/pmc04-conflict-detail.json
```

**第一轮结果**（observedAt 2026-10-08 11:37:24 +08:00）：

| 检测项 | 结果 |
| --- | --- |
| customers_without_person | 3（customer_id: 786, 789, 790，均未软删） |
| persons_without_legacy | 4（person_id: 786, 787 未软删；880029290001, 880029290003 已软删） |
| duplicate_legacy_count | 0 |
| multi_customer_count | 0 |
| softdelete_mismatch_count | 0 |
| field_conflicts.total_compared | 779 |
| field_conflicts.name_diff | 0 |
| field_conflicts.conflict_row_count | 1（person 783/customer 788, occupation_only_customer） |
| same_name_different_person | 7 组 / 14 人 |
| orphans（全 10 类） | 全 0 |

**第二轮结果**（observedAt 2026-10-08 11:39:14 +08:00）：

| 检测项 | 结果 |
| --- | --- |
| person 786（无 legacy） | source=人工新增；role=recruit；recruit_candidates 引用=1 → 正常纯招募 Person |
| person 787（无 legacy） | source=人工新增；has_role=false；interactions=2, opportunities=1 → 待确认 |
| person 880029290001（软删） | source=[CRM_TEST_ONLY]；activity_participants 引用=1 → 测试数据 |
| person 880029290003（软删） | source=[CRM_TEST_ONLY]；activity_speakers 引用=1 → 测试数据 |
| customer 786 | source=快速记录；无业务引用 → 孤立客户 |
| customer 789 | source=null；无业务引用 → 孤立客户 |
| customer 790 | source=快速记录；无业务引用 → 孤立客户 |
| same_name_contact_analysis | 7 组全部 all_phones_empty=true, all_wechats_empty=true |
| merge_candidate_count | 0（无非空 phone/wechat 可比对） |

**关键发现**：同名不同人 7 组 14 人的全部基础资料字段（phone/wechat/birthday/gender/occupation/organization/education）均为空（哈希 d41d8cd98f00b204e9800998ecf8427e = md5('')），无法通过 phone/wechat 自动判断是否为同一人。**必须人工确认**。

---

## 3. SQL 修订记录

- 第一版 conflict-check-detail.sql 使用 `pr.role_type` 导致 `column does not exist`；修正为 `pr.role`（person_roles 表实际列名为 `role`）。
- 两份 SQL 均通过 pg-readonly assertReadOnly 校验（单条 WITH/SELECT，拒绝 DDL/DML/多语句）。

---

## 4. 脱敏声明

- conflict-check.sql 输出：对象 ID + 差异布尔标记 + 计数。无真实 PII 值。
- conflict-check-detail.sql 输出：对象 ID + phone/wechat/birthday/gender/occupation/organization/education 的 md5 哈希。无真实 PII 值。
- name_key 用 md5 哈希脱敏，不输出归一化姓名。
- 真实客户资料需查看时登录生产系统，不入 Git。

---

## 5. 未验证项与限制

- **未执行生产数据修复**：A1–A3（建 Person）、A5（person 787 身份核实）、D1（occupation 同步）、E1–E7（同名不同人合并/确认）均留待 PMC-06。
- **未演练**：resolveName 对 3 个无 Person 客户的解析（需实施包单独授权）。
- **同名不同人 7 组**：因基础资料全空，merge_candidate_count=0；无法自动判断，必须人工核实。

---

## 6. 阻断声明

| 阻断项 | 阻断目标 | 解除条件 |
| --- | --- | --- |
| E1–E7（7 组同名不同人） | D5（customers UNIQUE(customer_name) 退出） | 7 组全部经人工确认（合并或标注同名不同人已确认） |
| 无 | customers.person_id 回填 | 不阻断（A1–A3 的 3 个 customer 不回填即可） |

---

## 7. 发布与三端核对

**发布命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "PMC-04 人物身份及数据冲突确认：两轮只读冲突检测SQL+脱敏清单+五分类确认清单；纯文档/工具包，不自动合并、不批量改写真实人物、不执行生产数据修复、云端业务产物未改变"
```

**回填项**（2026-10-08 实测）：
- 主提交 SHA：`313e23c3c82a12b204a7b962370ac256b1c24ee8`（`313e23c`）
- 发布标签（时间戳）：`release-20261008-115430`
- 是否首提交（需 semver）：否（当前基线 v2.1.0 已设于 WP2，本包不递进 semver）
- GitHub push 结果：`a2c07f4..313e23c HEAD -> master`；`[new tag] release-20261008-115430`
- 云端部署范围：**无业务产物部署**（纯文档/工具包；sync-check 仅做源码核对，未触发 tcb fn code update 或 hosting deploy）
- sync-check.ps1 结果：全绿——56 份共享副本（db.js `124c6ac6…` / ai.js `6fa94a41…`）一致；50 个静态资源（2 HTML + 48 console 模块链）一致；28 个函数 170 个源/配置文件一致；GitHub master 与 release tags 一致 HEAD `313e23c`；云端 admin.html HTTP 200 + SHA-256 一致
- 三端一致性（本地/GitHub/云端 admin.html）：**全部一致**
- WP01 门槛：`releaseGate=PASS_WITH_LIMITATIONS`（107 PASS/0 FAIL/5 SKIP，blockers=[]，open 项=login/service-runtime/live-writes/mobile 均为非阻断 UNVERIFIED/MANUAL_LOGIN）；发布前刷新 catalog.sql/audit.sql 快照（pg-readonly --snapshot）；第一次沙箱内运行 account.logout/account.password 间歇性 FAIL（puppeteer DOM 加载，非 PMC-04 引入），禁用沙箱重跑后 107/0/5 通过
