-- PMC-19 CL-05 rollback: ADD recruit_candidates.education
-- 原始状态: 全 NULL; 回填 NULL 即恢复真实值
-- 注意: 若需恢复约束/默认须另写

ALTER TABLE public.recruit_candidates ADD COLUMN education text;
