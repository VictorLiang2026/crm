-- Rollback of 20261010223000_pmc20_restore_view_security_invoker.sql:
-- returns views to the post-rebuild state (security_invoker unset/false).
-- NOTE: this re-introduces the RLS-bypass regression; keep for rollback only.
ALTER VIEW public.ai_recommendations_view SET (security_invoker = false);
ALTER VIEW public.customers_view SET (security_invoker = false);
ALTER VIEW public.followups_view SET (security_invoker = false);
ALTER VIEW public.gifts_view SET (security_invoker = false);
ALTER VIEW public.photos_view SET (security_invoker = false);
ALTER VIEW public.products_view SET (security_invoker = false);
ALTER VIEW public.v_action_center SET (security_invoker = false);
ALTER VIEW public.v_recruit_candidates SET (security_invoker = false);
ALTER VIEW public.v_recruit_candidates_person_only SET (security_invoker = false);
ALTER VIEW public.v_recruit_candidates_person_only_trash SET (security_invoker = false);
ALTER VIEW public.v_recruit_candidates_trash SET (security_invoker = false);
