-- PMC-18 rollback：删除观察记录表 + 审计触发器
-- rollback: 20261010115000_pmc18_observation_table.rollback.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. 删除审计触发器和函数
DROP TRIGGER IF EXISTS pmc18_customers_basics_audit ON public.customers;
DROP FUNCTION IF EXISTS public.pmc18_customers_basics_audit_fn();

-- 1b. 删除指标采集函数
DROP FUNCTION IF EXISTS public.pmc18_collect_metrics();

-- 2. 删除观察记录表
DROP TABLE IF EXISTS public.pmc18_observations;

-- 3. 回收授权（表已删除，授权自动失效；显式回收以防残留）
REVOKE ALL ON public.pmc18_observations FROM service_role, anon, authenticated;

COMMIT;
