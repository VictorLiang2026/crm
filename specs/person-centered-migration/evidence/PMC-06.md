# PMC-06 证据（evidence/PMC-06）

状态：**已回填完成**。基线：`ac78bdd` / `release-20261008-1905`；实测日期 2026-10-08。

---

## 1. 产物清单

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `tools/pmc06-backfill-b1-simple.cjs` | B1 批次回填脚本（简化版） | 已落盘（未实际使用，改用直接 SQL） |
| `tests/security/.results/pmc06-backup-customers-before.json` | 回填前备份（未实际生成，改用 UPDATE 直接回填） | 未生成 |
| `tests/security/.results/pmc06-batch-log.json` | 批次日志 | 已生成 |

---

## 2. 执行记录（2026-10-08）

### 执行方式

直接用 `tcb db execute` 执行 UPDATE 子查询（简化版，不经过脚本）：

```sql
UPDATE customers SET person_id = (
  SELECT id FROM persons
  WHERE legacy_customer_id = customers."Id" AND deleted_at IS NULL
)
WHERE person_id IS NULL AND deleted_at IS NULL
```

### 执行结果

| 项 | 值 |
| --- | --- |
| AffectedRows | **782** |
| ExecutionTimeMs | 249ms |
| 时间点 | 2026-10-08 07:40 UTC |

---

## 3. 回填后核对（2026-10-08 实测）

### 3.1 覆盖率

| 指标 | 值 | 状态 |
| --- | --- | --- |
| 未软删 customers 总数 | 782 | ✅ |
| 已回填 person_id | **779** | ✅（预期 779，M1 已确认对） |
| 未回填 person_id | **3** | ✅（A1–A3：无 Person 的 customer，留待 PMC-06 后续确认） |

### 3.2 孤立引用

| 指标 | 值 | 状态 |
| --- | --- | --- |
| customers.person_id 指向不存在 persons.id | **0** | ✅ |

### 3.3 一对一完整性

| 指标 | 值 | 状态 |
| --- | --- | --- |
| 重复 person_id（多 customers 指向同一 person） | **0** | ✅ |

---

## 4. 批次日志

| 项 | 值 |
| --- | --- |
| 批次 | B1（单批次全量回填） |
| 处理行数 | 782 |
| 成功 | 779 |
| 跳过 | 3（A1–A3：无对应 Person） |
| 失败 | 0 |
| 并发冲突 | 0 |

**注意**：本次回填用单批次 UPDATE 子查询（非逐行循环），因此无批次间中断恢复点。回填后核对全部通过，无需恢复。

---

## 5. 未处理项（留待后续）

| 项 | 原因 | 后续处理 |
| --- | --- | --- |
| A1–A3（customer 786/789/790） | 无对应 Person（legacy customers.create 不建 Person） | 用户确认：建 Person 或标记不迁移 |
| A5（person 787） | 有互动+机会但无客户角色 | 用户核实身份来源 |
| D1（occupation 单边差异） | customers.occupation 有值，persons.occupation 为空 | 用户确认同步方向 |
| E1–E7（7 组同名不同人） | 基础资料全空，无法自动判断 | 人工核实真实资料 |

---

## 6. 发布与三端核对（待回填）

**发布命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "PMC-06 B1 批次回填：customers.person_id 已回填 779 行（M1 已确认对）；孤立引用 0、一对一完整性 0；未处理 A1–A3/A5/D1/E1–E7 留待后续确认"
```

**回填项**：
- 主提交 SHA：____
- 发布标签（时间戳）：`release-____________-____`
- 是否首提交（需 semver）：否
- GitHub push 结果：____
- 云端部署范围：____
- sync-check.ps1 结果：____
- 三端一致性：____
