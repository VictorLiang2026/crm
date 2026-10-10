-- PMC-20 hotfix: restore security_invoker on views rebuilt by 20261010164000
-- (CREATE OR REPLACE VIEW reset the view reloptions; the rebuild's assumption
--  that reloptions survive replacement did not hold, leaving 11 views without
--  caller RLS enforcement. Baseline expected security_invoker = true.)
ALTER VIEW public.ai_recommendations_view SET (security_invoker = true);
ALTER VIEW public.customers_view SET (security_invoker = true);
ALTER VIEW public.followups_view SET (security_invoker = true);
ALTER VIEW public.gifts_view SET (security_invoker = true);
ALTER VIEW public.photos_view SET (security_invoker = true);
ALTER VIEW public.products_view SET (security_invoker = true);
ALTER VIEW public.v_action_center SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates_person_only SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates_person_only_trash SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates_trash SET (security_invoker = true);
