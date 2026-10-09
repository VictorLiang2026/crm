-- Rollback: 恢复 authenticated 对招募视图的直授 SELECT
-- 回滚条件：如需恢复 G-PMC11-2 修复后的授权状态（authenticated 可直读视图元数据，security_invoker 仍防护基表）。

GRANT SELECT ON public.v_recruit_candidates TO authenticated;
GRANT SELECT ON public.v_recruit_candidates_trash TO authenticated;
