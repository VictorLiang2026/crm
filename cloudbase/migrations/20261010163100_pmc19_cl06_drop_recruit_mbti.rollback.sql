-- PMC-19 CL-06 rollback: ADD recruit_candidates.mbti
-- 原始状态: 全 NULL; 回填 NULL 即恢复真实值

ALTER TABLE public.recruit_candidates ADD COLUMN mbti text;
