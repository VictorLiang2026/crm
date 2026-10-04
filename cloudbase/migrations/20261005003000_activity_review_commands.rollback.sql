-- Roll back the WP12 command surface only after assessing any accepted business rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_activity_review_commands
    WHERE executed_at IS NOT NULL AND operation IN ('action','opportunity','outcome')) THEN
    RAISE EXCEPTION 'WP12 accepted business data exists; assess Action/Candidate/Outcome IDs before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.crm_activity_review_execute_v1(text,uuid);
DROP FUNCTION public.crm_activity_review_preview_v1(text,uuid,text,bigint,bigint,integer,jsonb);
DROP TABLE public.crm_activity_review_source_claims;
DROP TABLE public.crm_activity_review_commands;
COMMIT;
