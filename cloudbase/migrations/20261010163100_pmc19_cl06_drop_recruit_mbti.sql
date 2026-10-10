-- PMC-19 CL-06: DROP recruit_candidates.mbti 死列
-- 依据: pmc-19-cleanup-proposal.md §3 CL-06
-- 实测: 18 行 mbti 0 非空; 0 代码消费者; v_recruit_candidates 读 c.mbti(非 rc.mbti)
-- 权威: customers.mbti
-- 角色: cloudbase_postgres (表 owner)
-- 加锁: ACCESS EXCLUSIVE recruit_candidates, <10ms, 无停机
-- 回滚: ADD COLUMN mbti text (原始全 NULL, 回填 NULL 即恢复真实值)

ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS mbti;
