-- PC29 data and permission verification. Every database object is explicitly public.
SELECT table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('ai_result_feedback_events','outcomes','learnings')
ORDER BY table_name,ordinal_position;

SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c
WHERE c.relnamespace='public'::regnamespace AND c.relname='ai_result_feedback_events';

SELECT schemaname,tablename,policyname,roles,cmd
FROM pg_policies
WHERE schemaname='public' AND tablename='ai_result_feedback_events'
ORDER BY policyname;

SELECT table_name,grantee,privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='ai_result_feedback_events'
ORDER BY table_name,grantee,privilege_type;

SELECT proname,proacl::text
FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname LIKE 'crm_ai_experience_%'
ORDER BY proname;

SELECT count(*) AS remaining_pc29_feedback_fixtures FROM public.ai_result_feedback_events
WHERE actor_uid LIKE '[CRM_TEST_ONLY]%';
SELECT count(*) AS remaining_pc29_outcome_fixtures FROM public.outcomes
WHERE recorded_by_uid LIKE '[CRM_TEST_ONLY]%' AND idempotency_key IS NOT NULL;
SELECT count(*) AS remaining_pc29_learning_fixtures FROM public.learnings
WHERE confirmed_by_uid LIKE '[CRM_TEST_ONLY]%' AND candidate_key IS NOT NULL;
