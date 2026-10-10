-- PMC-19 CL-01 rollback: ADD customers UNIQUE(customer_name)
-- 注意: 须先校验无重复活跃客户名; 若有重复须先并档或标注
-- 校验: SELECT customer_name, COUNT(*) FROM public.customers WHERE deleted_at IS NULL GROUP BY customer_name HAVING COUNT(*) > 1;
-- 当前实测: 0 重复 (catalog c11)

ALTER TABLE public.customers ADD CONSTRAINT "客户列表_姓名_key" UNIQUE (customer_name);
