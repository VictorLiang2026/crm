-- Restores the verified pre-change permissions, including their known risks. No data changes.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.policy_review_reports DISABLE ROW LEVEL SECURITY;
ALTER VIEW public."ai_recommendations_view" RESET (security_invoker);
ALTER VIEW public."customers_view" RESET (security_invoker);
ALTER VIEW public."followups_view" RESET (security_invoker);
ALTER VIEW public."gifts_view" RESET (security_invoker);
ALTER VIEW public."photos_view" RESET (security_invoker);
ALTER VIEW public."products_view" RESET (security_invoker);
ALTER VIEW public."v_action_center" RESET (security_invoker);
ALTER VIEW public."v_funnel_stats" RESET (security_invoker);
ALTER VIEW public."v_recruit_candidates" RESET (security_invoker);
ALTER VIEW public."v_recruit_candidates_trash" RESET (security_invoker);
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public."activities", public."activity_participants", public."activity_speakers", public."activity_tasks", public."activity_topics", public."ai_recommendations", public."customers", public."followups", public."gifts", public."ocr_records", public."opportunities", public."photos", public."policy_review_reports", public."products", public."recruit_candidates", public."recruit_followups", public."recruit_goal_benchmarks", public."recruit_goals", public."recruit_milestones", public."ai_recommendations_view", public."customers_view", public."followups_view", public."gifts_view", public."photos_view", public."products_view", public."v_action_center", public."v_funnel_stats", public."v_recruit_candidates", public."v_recruit_candidates_trash" TO authenticated;
COMMIT;
