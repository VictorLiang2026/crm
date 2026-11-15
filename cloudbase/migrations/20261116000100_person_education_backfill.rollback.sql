-- Never discard reviewed results, batch progress or audit history through a schema rollback.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.person_education_batches) OR
    EXISTS(SELECT 1 FROM public.person_education_changes) THEN
    RAISE EXCEPTION 'Education rollback blocked: preserve and review batch/audit data first';
  END IF;
END $guard$;
DROP FUNCTION public.crm_education_backfill_v1(text,text,jsonb);
DROP FUNCTION public.crm_education_context_v1(bigint);
DROP TABLE public.person_education_changes;
DROP TABLE public.person_education_previews;
DROP TABLE public.person_education_items;
DROP TABLE public.person_education_batches;
COMMIT;
