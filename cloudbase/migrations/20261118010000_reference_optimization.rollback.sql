BEGIN;
SET LOCAL lock_timeout='5s';
-- Do not silently destroy revisions, flags, preferences or job history.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_reference_versions WHERE source<>'original') OR
 EXISTS(SELECT 1 FROM public.crm_reference_jobs) OR EXISTS(SELECT 1 FROM public.crm_reference_batches) OR
 EXISTS(SELECT 1 FROM public.crm_reference_previews) OR EXISTS(SELECT 1 FROM public.crm_reference_preferences) OR
 EXISTS(SELECT 1 FROM public.crm_reference_state WHERE pinned OR want_system OR want_gpt OR instruction<>'') THEN
  RAISE EXCEPTION 'Export reference revisions and assess active work before rollback';
 END IF;
END $guard$;
DROP TRIGGER reference_capture ON public.playbooks;
DROP FUNCTION public.crm_reference_capture_v1();
DROP FUNCTION public.crm_reference_workflow_v1(text,text,jsonb);
DROP TABLE public.crm_reference_previews;
DROP TABLE public.crm_reference_jobs;
DROP TABLE public.crm_reference_batches;
DROP TABLE public.crm_reference_preferences;
DROP TABLE public.crm_reference_state;
DROP TABLE public.crm_reference_versions;
COMMIT;
