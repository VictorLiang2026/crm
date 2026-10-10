-- PMC-19 CL-01: DROP customers UNIQUE(customer_name) 约束 D5
-- 依据: pmc-19-cleanup-proposal.md §3 CL-01; decisions.md D5 (2026-10-07 批准)
-- 实测: customers 783/783 person_id NOT NULL; 重复活跃客户名 0; 身份=person_id(非姓名)
-- 角色: cloudbase_postgres (表 owner)
-- 加锁: ACCESS EXCLUSIVE customers, <10ms (仅删 catalog 行), 无停机
-- 回滚: ADD CONSTRAINT 须先校验无重复名

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS "客户列表_姓名_key";
