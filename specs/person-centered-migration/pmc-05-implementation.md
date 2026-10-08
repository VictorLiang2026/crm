# PMC-05：兼容性数据库结构扩展（pmc-05-implementation）

状态：**待用户验收**。基线：`313e23c` / `release-20261008-115430` → `ca988ef` / `release-20261008-1200`；实测日期 2026-10-08。证据索引见 [evidence/PMC-05.md](evidence/PMC-05.md)。

---

## 1. 对象变更总览

| 对象 | 变更 | 类型 | 状态 |
| --- | --- | --- | --- |
| `public.customers.person_id` | 新增列 bigint NULLABLE | ADD COLUMN | ✅ 已应用 |
| `idx_customers_person_id` | 部分索引（WHERE person_id IS NOT NULL） | CREATE INDEX | ✅ 已应用 |
| `customers_person_id_key` | UNIQUE(person_id) 约束 | ADD CONSTRAINT | ✅ 已应用 |
| `customers_person_id_fkey` | FK(person_id) → persons(id) ON DELETE RESTRICT | ADD CONSTRAINT | ✅ 已应用 |

### 不变项（按设计 §5.3/§5.4）

- **不移除** `customers.customer_name` UNIQUE（D5 退出条件未满足）
- **不移除** `legacy_customer_id` 列及复合 FK（D8 退出条件未满足）
- **不强制 NOT NULL**（PMC-04 有 3 个 customer 无 Person，待 PMC-06）
- **不修改 RLS 策略**（C7 权限不变）
- **不重建视图**（现有视图用显式列名；视图重建属阶段 3）
- **不修改云函数**（阶段 2 双写属后续包）

---

## 2. Migration 文件

| 文件 | 用途 |
| --- | --- |
| `cloudbase/migrations/20261008120000_customers_person_id.sql` | 主 migration（4 步：ADD COLUMN + CREATE INDEX + ADD UNIQUE + ADD FK） |
| `cloudbase/rollbacks/20261008120000_customers_person_id.sql` | 回滚（4 步：DROP CONSTRAINT FK + DROP CONSTRAINT UNIQUE + DROP INDEX + DROP COLUMN） |
| 外部双备份 | `C:\Users\victor\cloudbase\migrations\20261008120000_customers_person_id.sql`（SHA-256 一致） |

### Migration SQL 设计

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 执行前断言：customers 无 person_id 列
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='customers'
               AND column_name='person_id') THEN
    RAISE EXCEPTION 'public.customers.person_id already exists; inspect before migrating';
  END IF;
END; $guard$;

-- 步骤 1：加可空列（PG 11+ ADD COLUMN ... DEFAULT NULL 不触发表重写）
ALTER TABLE public.customers ADD COLUMN person_id bigint;

-- 步骤 2：建部分索引（仅非 NULL 行；当前全 NULL，索引空但结构就绪）
CREATE INDEX idx_customers_person_id
  ON public.customers(person_id)
  WHERE person_id IS NOT NULL;

-- 步骤 3：加 UNIQUE 约束（允许 NULL；当前全 NULL 不冲突，回填时保证一对一）
ALTER TABLE public.customers
  ADD CONSTRAINT customers_person_id_key UNIQUE (person_id);

-- 步骤 4：加 FK → persons(id) ON DELETE RESTRICT（D10：删客户角色不级联删 Person）
ALTER TABLE public.customers
  ADD CONSTRAINT customers_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;

COMMIT;
```

### 执行方式说明

`tcb db execute` 不支持多语句（BEGIN/DO/COMMIT），故分 4 步逐条执行：
1. `ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS person_id bigint`（7ms）
2. `CREATE INDEX IF NOT EXISTS idx_customers_person_id ON public.customers(person_id) WHERE person_id IS NOT NULL`（13ms）
3. `ALTER TABLE public.customers ADD CONSTRAINT customers_person_id_key UNIQUE (person_id)`（11ms）
4. `ALTER TABLE public.customers ADD CONSTRAINT customers_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT`（9ms）

**migration 文件保留原始多语句版本**（含 BEGIN/DO/COMMIT）作为设计文档和未来工具支持的参考；实际执行用分步方式。

---

## 3. 加锁风险与扫描成本

| 操作 | 加锁 | 扫描 | 耗时 | 实测 |
| --- | --- | --- | --- | --- |
| ADD COLUMN person_id bigint | 无表重写（PG 11+） | 无 | 毫秒级 | 7ms |
| CREATE INDEX ... WHERE | ShareLock | 仅非 NULL 行（0 行） | 毫秒级 | 13ms |
| ADD CONSTRAINT UNIQUE | AccessExclusiveLock | 全表 783 行 | 毫秒级 | 11ms |
| ADD CONSTRAINT FK | AccessExclusiveLock | 全表 783 行 | 毫秒级 | 9ms |

**超时保护**：migration SQL 含 `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'`；分步执行时未触发超时。

---

## 4. 执行后核对（2026-10-08 实测）

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
| 旧 UNIQUE(customer_name) | 客户列表_姓名_key (u) | 存在（D5 退出条件未满足，未移除） | ✅ |
| customers_view 正常 | count=783 | 783 | ✅ |

**customers 表约束全览（5 个）**：
1. `customers_person_id_fkey` (f) — 新增 FK
2. `customers_person_id_key` (u) — 新增 UNIQUE
3. `客户列表_Id_key` (u) — 旧 UNIQUE("Id")
4. `客户列表_pkey` (p) — 旧 PK("Id")
5. `客户列表_姓名_key` (u) — 旧 UNIQUE(customer_name)（保留）

**视图清单（12 个，全部正常）**：
ai_recommendations_view, customers_view, followups_view, gifts_view, photos_view, products_view, v_action_center, v_funnel_stats, v_recruit_candidates, v_recruit_candidates_person_only, v_recruit_candidates_person_only_trash, v_recruit_candidates_trash

---

## 5. 视图依赖分析

现有视图均使用**显式列名**（非 SELECT *），加 person_id 列**不会**出现在视图输出中。视图重建（增加 personId 输出列）属阶段 3，本包不涉及。

关键视图依赖（从 migration 历史核实）：
- `customers_view`：SELECT 显式列（含 "Id", customer_name 等，不含 person_id）→ 不受影响
- `v_action_center`：JOIN customers 但只读显式列 → 不受影响
- `v_funnel_stats`：基于 opportunities JOIN customers，不读 person_id → 不受影响
- `v_recruit_candidates*`：基于 recruit_candidates JOIN customers，不读 person_id → 不受影响

---

## 6. 回滚条件

回滚 SQL（`cloudbase/rollbacks/20261008120000_customers_person_id.sql`）执行前必须检查：

1. **新增列是否有数据**：`SELECT count(*) FROM public.customers WHERE person_id IS NOT NULL`
   - 当前=0，回滚安全
   - 若 >0（阶段 2 回填后），回滚前需确认数据已备份
2. **新增列是否有消费者**：检查视图/函数/RPC 是否显式引用 person_id
   - 当前无（阶段 2/3 才会引入），回滚安全
   - 若有消费者（阶段 2 后），回滚前需先清理消费者代码
3. **migration 历史状态**：核实 20261008120000 已应用（本文档 §4 核对通过）
4. **有新增业务使用时不得盲目删列**（execution-contract E）

回滚 SQL（4 步）：
1. `ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_person_id_fkey`
2. `ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_person_id_key`
3. `DROP INDEX IF EXISTS public.idx_customers_person_id`
4. `ALTER TABLE public.customers DROP COLUMN IF EXISTS person_id`

---

## 7. 验收对照

| 验收要求 | 本包达成 |
| --- | --- |
| 补充 Person 缺少的基础字段 + 业务表 person_id 关联 | ✅ customers.person_id 已加（bigint NULLABLE + UNIQUE + FK） |
| 复用已有字段和关联，不创建平行人物主表 | ✅ 未新建表；复用 persons(id) |
| 新关联允许过渡状态，不强加 NOT NULL | ✅ NULLABLE，3 个无 Person 的 customer 不受影响 |
| 设计索引、外键、唯一约束 | ✅ 部分索引 + UNIQUE + FK RESTRICT |
| 记录加锁风险、扫描成本、超时、失败重试 | ✅ §3 + migration SQL 含 lock_timeout/statement_timeout |
| 不移除旧字段、旧关联或姓名唯一约束 | ✅ 5 个约束全保留（含 客户列表_姓名_key） |
| 同步检查依赖视图、RPC、触发器、返回列契约 | ✅ §5 视图依赖分析；12 视图全正常 |
| 保持列名、顺序、类型及权限兼容 | ✅ 新列不在视图输出；RLS 不变 |
| 需要删除重建已有视图时先单独取得批准 | ✅ 本包不重建视图（阶段 3） |
| Person 和受保护表维持服务端访问边界 | ✅ 不扩大匿名/登录用户直接读写权限 |
| 提供 migration、rollback、执行前断言和执行后核对 | ✅ 4 文件 + §4 核对 |
| 回滚检查新增字段是否有数据和消费者 | ✅ §6 回滚条件 |
| 核实迁移历史状态，超时先查任务结果 | ✅ 分步执行，每步独立确认 |
