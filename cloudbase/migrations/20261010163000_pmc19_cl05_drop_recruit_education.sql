-- PMC-19 CL-05: DROP recruit_candidates.education 死列
-- 依据: pmc-19-cleanup-proposal.md §3 CL-05
-- 实测: 18 行 education 0 非空; 0 代码消费者; v_recruit_candidates 读 p.education/c.education(非 rc.education)
-- 权威: persons.education / customers.education
-- 角色: cloudbase_postgres (表 owner)
-- 加锁: ACCESS EXCLUSIVE recruit_candidates, <10ms, 无停机
-- 回滚: ADD COLUMN education text (原始全 NULL, 回填 NULL 即恢复真实值)

ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS education;
