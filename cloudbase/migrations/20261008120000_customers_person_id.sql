-- PMC-05: Add customers.person_id column (nullable) + UNIQUE + FK to persons(id) + partial index.
-- 设计依据：data-model.md §5.1 D1（customers.person_id bigint UNIQUE，回填完成后置 NOT NULL）
-- 本步只做 ①加可空列 + ④加 UNIQUE + FK + 索引（不加 NOT NULL，因 PMC-04 有 3 个 customer 无 Person 待确认）
-- 不移除：customers.customer_name UNIQUE（D5 退出条件未满足）、legacy_customer_id（D8 退出条件未满足）
-- 视图影响：现有视图用显式列名（非 SELECT *），加列不影响视图输出；视图重建属阶段 3
-- 加锁风险：ALTER TABLE ADD COLUMN 默认 NULL 无表重写（PG 11+）；ADD CONSTRAINT UNIQUE/FK 需扫描表（783 行，毫秒级）
-- 回滚：见 20261008120000_customers_person_id.rollback.sql（检查新增列是否有数据和消费者）

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 执行前断言：customers 无 person_id 列（避免重复 migration）
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
-- 命名：customers_person_id_key（与 PG 默认命名规则一致）
ALTER TABLE public.customers
  ADD CONSTRAINT customers_person_id_key UNIQUE (person_id);

-- 步骤 4：加 FK → persons(id) ON DELETE RESTRICT
-- ON DELETE RESTRICT：禁止删除被 customers 引用的 Person（D10：删客户角色不级联删 Person）
ALTER TABLE public.customers
  ADD CONSTRAINT customers_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;

COMMIT;
