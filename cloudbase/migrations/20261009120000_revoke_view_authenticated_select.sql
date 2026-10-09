-- PMC-12 发布前置：撤销 authenticated 对招募视图的直授 SELECT
-- 背景：G-PMC11-2 修复 migration 20261009070000 幂等复制了原始 2026-09-05 GRANT（含 authenticated SELECT），
--   导致 WP01 基线比对漂移（基线期望 authenticated=[]）。
-- 安全评估：两视图 security_invoker=true，authenticated 即使有 SELECT 也读不到基表数据（RLS 防护），
--   REVOKE 仅额外收紧，不影响 callFn（service_role）通道。admin.html/console.html 均走 callFn。
-- 影响范围：仅 public.v_recruit_candidates / public.v_recruit_candidates_trash 两视图的 authenticated 直授权限。
-- 无数据变更，无结构变更，无新授权。

REVOKE SELECT ON public.v_recruit_candidates FROM authenticated;
REVOKE SELECT ON public.v_recruit_candidates_trash FROM authenticated;
