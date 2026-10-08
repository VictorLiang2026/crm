# PMC-05 证据（evidence/PMC-05）

状态：**待回填发布标签**。基线：`ca988ef` / `release-20261008-1200`；实测日期 2026-10-08。

---

## 1. 产物清单

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `specs/person-centered-migration/pmc-05-implementation.md` | 实施文档（7 节：变更总览/migration SQL/加锁风险/执行后核对/视图依赖/回滚条件/验收对照） | 已落盘 |
| `cloudbase/migrations/20261008120000_customers_person_id.sql` | 主 migration（4 步：ADD COLUMN + CREATE INDEX + ADD UNIQUE + ADD FK） | 已落盘+已应用 |
| `cloudbase/rollbacks/20261008120000_customers_person_id.sql` | 回滚（4 步：DROP CONSTRAINT + INDEX + COLUMN） | 已落盘 |
| `tools/migration-apply.cjs` | migration 执行工具（经 cloudbase-mcp，支持 DDL） | 已落盘（MCP 认证失效未用上；实际用 tcb db execute） |
| 外部双备份 | `C:\Users\victor\cloudbase\migrations\20261008120000_customers_person_id.sql`（SHA-256 一致） | 已备份 |
| `evidence/PMC-05.md` | 本文件 | 已落盘，§7 待回填 |

---

## 2. Migration 执行记录（2026-10-08）

### 执行方式

`tcb db execute` 不支持多语句（BEGIN/DO/COMMIT），故分 4 步逐条执行：

| 步骤 | SQL | 耗时 | 结果 |
| --- | --- | --- | --- |
| 1 | `ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS person_id bigint` | 7ms | AffectedRows=0 |
| 2 | `CREATE INDEX IF NOT EXISTS idx_customers_person_id ON public.customers(person_id) WHERE person_id IS NOT NULL` | 13ms | AffectedRows=0 |
| 3 | `ALTER TABLE public.customers ADD CONSTRAINT customers_person_id_key UNIQUE (person_id)` | 11ms | AffectedRows=0 |
| 4 | `ALTER TABLE public.customers ADD CONSTRAINT customers_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT` | 9ms | AffectedRows=0 |

**总耗时**：40ms（4 步合计）。

### 失败与教训

1. `migration-apply.cjs`（经 cloudbase-mcp）因 MCP 认证过期失败（"当前未登录"），改用 `tcb db execute`。
2. `tcb db execute` 不支持多语句（BEGIN/DO/COMMIT），第一次用 `--sql` 传整个文件只执行了第一条 BEGIN（4ms）。
3. `ADD CONSTRAINT IF NOT EXISTS` 语法不支持（SQLSTATE 42601），改为直接 ADD（已存在会报错，可忽略）。
4. 分步执行成功。

---

## 3. 执行后核对（2026-10-08 实测）

### 核对方法

用 `tcb db execute --sql` 逐条查询 information_schema/pg_constraint/pg_indexes/pg_views。

### 核对结果

| 核对项 | 预期 | 实测 | 状态 |
| --- | --- | --- | --- |
| person_id 列存在 | 1 | 1 | ✅ |
| 列类型 | bigint | bigint | ✅ |
| 列可空 | YES | YES | ✅ |
| UNIQUE 约束 | customers_person_id_key (u) | 存在 | ✅ |
| FK 约束 | customers_person_id_fkey (f) | 存在 | ✅ |
| FK 定义 | person_id → persons(id) ON DELETE RESTRICT | FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT | ✅ |
| 索引存在 | idx_customers_person_id | 存在 | ✅ |
| 数据未动 | person_id 全 NULL | 783 行 / 0 非空 | ✅ |
| 旧 PK 约束 | 客户列表_pkey (p) | 存在 | ✅ |
| 旧 UNIQUE("Id") | 客户列表_Id_key (u) | 存在 | ✅ |
| 旧 UNIQUE(customer_name) | 客户列表_姓名_key (u) | 存在 | ✅ |
| customers_view 正常 | count=783 | 783 | ✅ |

### customers 表约束全览（5 个）

| 约束名 | 类型 | 定义 |
| --- | --- | --- |
| customers_person_id_fkey | f (FK) | FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT |
| customers_person_id_key | u (UNIQUE) | UNIQUE (person_id) |
| 客户列表_Id_key | u (UNIQUE) | UNIQUE ("Id") |
| 客户列表_pkey | p (PK) | PRIMARY KEY ("Id") |
| 客户列表_姓名_key | u (UNIQUE) | UNIQUE (customer_name) |

### 视图清单（12 个，全部正常）

ai_recommendations_view, customers_view, followups_view, gifts_view, photos_view, products_view, v_action_center, v_funnel_stats, v_recruit_candidates, v_recruit_candidates_person_only, v_recruit_candidates_person_only_trash, v_recruit_candidates_trash

---

## 4. 未验证项与限制

- **未执行**：RLS 策略变更（本包不修改，C7 权限不变）
- **未执行**：云函数变更（阶段 2 双写属后续包）
- **未执行**：视图重建（阶段 3 属后续包）
- **未执行**：person_id 回填（PMC-04 待确认项留待 PMC-06）
- **未执行**：NOT NULL 约束（PMC-04 有 3 个 customer 无 Person，待 PMC-06 处理后才能加 NOT NULL）
- **未执行**：legacy_customer_id / customer_name UNIQUE 退出（D5/D8 退出条件未满足）
- **MCP 认证失效**：pg-readonly.cjs 和 migration-apply.cjs 均受影响；本次用 `tcb db execute` 替代

---

## 5. 阻断声明

无阻断项。本包只加结构（列+索引+约束），不改业务行为、不改视图、不改函数、不改 RLS。

---

## 6. 工具缺口

| 工具 | 状态 | 影响 |
| --- | --- | --- |
| `tools/pg-readonly.cjs` | MCP 认证失效 | 只读查询改用 `tcb db execute` |
| `tools/migration-apply.cjs` | 新建但 MCP 认证失效未用上 | 未来 MCP 重新认证后可用 |
| `tcb db execute` | 正常 | 本次实际使用；不支持多语句，需分步执行 |

---

## 7. 发布与三端核对

**发布命令**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release.ps1 -Message "PMC-05 兼容性数据库结构扩展：customers.person_id bigint NULLABLE+UNIQUE+FK RESTRICT+部分索引；migration 已应用（4 步 40ms）；旧约束完整、视图正常、数据未动；纯结构+migration 工具包，不修改云函数/视图/RLS"
```

**回填项**：
- 主提交 SHA：`ca988ef`（PMC-04 收尾回填）→ 本次发布提交 `313e23c`（PMC-04）→ `ca988ef`（PMC-05 产物）
- 发布标签（时间戳）：`release-20261008-1830`
- 是否首提交（需 semver）：否
- GitHub push 结果：成功（`ca988ef` 已推送）
- 云端部署范围：无业务产物部署（纯 migration SQL + 文档/工具；migration 已通过 tcb db execute 直接应用到数据库）
- sync-check.ps1 结果：WP01 gate PASS；56 份共享副本一致；50 个静态资源一致；28 个函数 170 个文件一致；云端 admin.html SHA-256 一致
- 三端一致性：全绿 ✅
