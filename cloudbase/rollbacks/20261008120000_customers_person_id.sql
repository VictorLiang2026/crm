-- PMC-05 回滚：移除 customers.person_id 列及关联约束/索引
-- 回滚前检查（见 pmc-05-implementation.md §6 回滚条件）：
--   1. 新增列是否有数据（person_id 非空行数）
--   2. 新增列是否有消费者（视图/函数/RPC 显式引用 person_id）
--   3. migration 历史状态（核实 20261008120000 是否已应用）
-- 有新增业务使用时不得盲目删列；先清理消费者再回滚

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 移除外键约束
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_person_id_fkey;

-- 移除 UNIQUE 约束
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_person_id_key;

-- 移除部分索引
DROP INDEX IF EXISTS public.idx_customers_person_id;

-- 移除列（CASCADE 确保无残留依赖）
ALTER TABLE public.customers DROP COLUMN IF EXISTS person_id;

COMMIT;
