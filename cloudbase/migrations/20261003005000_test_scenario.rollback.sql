-- Restore affected code first. Preserve all samples, IDs and WP02 ledgers.
-- Once samples exist, disabling tracking needs a separately reviewed data plan.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE t text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_test_records) THEN
  RAISE EXCEPTION 'Populated test registry: rollback requires a data/trace preservation plan';
 END IF;
 FOREACH t IN ARRAY ARRAY['actions','activities','activity_participants','activity_speakers','activity_tasks','activity_topics',
 'ai_recommendations','ai_results','ai_runs','ai_tasks','assistant_action_commands','commitments','context_items','customers',
 'followups','gifts','household_members','households','interactions','knowledge_items','learnings','ocr_records','opportunities',
 'opportunity_candidates','outcomes','person_roles','persons','photos','playbooks','policy_review_reports','products',
 'recruit_candidates','recruit_followups','recruit_goal_benchmarks','recruit_goals','recruit_milestones','relationships']
 LOOP EXECUTE format('DROP TRIGGER zz_crm_test_track ON public.%I',t); END LOOP;
END $guard$;
DROP FUNCTION public.crm_test_scenario_v1(text,text,uuid,text);
DROP FUNCTION public.crm_test_link_ai_v1(bigint,jsonb);
DROP FUNCTION public.crm_test_track_v1();
DROP FUNCTION public.crm_test_refs_v1(jsonb,text);
DROP TABLE public.crm_test_previews;
COMMIT;
