-- PC29 rollback is guarded: it stops if PC29 user data exists. Export/retain that data
-- and prepare a reviewed data plan before removing this schema in a later release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_result_feedback_events) OR
     EXISTS (SELECT 1 FROM public.outcomes WHERE idempotency_key IS NOT NULL OR recruit_followup_id IS NOT NULL OR evidence IS NOT NULL OR recorded_by_uid IS NOT NULL) OR
     EXISTS (SELECT 1 FROM public.learnings WHERE candidate_key IS NOT NULL OR sample_size IS NOT NULL OR counterexamples IS NOT NULL OR provenance IS NOT NULL) THEN
    RAISE EXCEPTION 'PC29 data exists; export and review before rollback';
  END IF;
END
$guard$;

DROP FUNCTION public.crm_ai_experience_confirm_learning_v1(text,bigint,text);
DROP FUNCTION public.crm_ai_experience_metrics_v1(integer);
DROP FUNCTION public.crm_ai_experience_learning_v1(text,uuid,jsonb);
DROP FUNCTION public.crm_ai_experience_outcome_v1(text,uuid,text,bigint,bigint,text,timestamptz,text);
DROP FUNCTION public.crm_ai_experience_decide_v1(text,uuid,bigint,text,text,jsonb);
DROP INDEX public.learnings_candidate_key_uidx;
DROP INDEX public.outcomes_idempotency_key_uidx;
DROP INDEX public.outcomes_recruit_followup_idx;
ALTER TABLE public.learnings
  DROP COLUMN candidate_key,DROP COLUMN provenance,DROP COLUMN counterexamples,DROP COLUMN sample_size;
ALTER TABLE public.outcomes
  DROP COLUMN idempotency_key,DROP COLUMN recorded_by_uid,DROP COLUMN evidence,DROP COLUMN recruit_followup_id;
DROP TABLE public.ai_result_feedback_events;
NOTIFY pgrst, 'reload schema';
COMMIT;
