-- Restore prior function code first. Never undo confirmed business changes implicitly.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_legacy_opportunity_commands) THEN
   RAISE EXCEPTION 'Legacy Opportunity command history exists; retain schema and assess rollback';
 END IF;
END $guard$;
DROP FUNCTION public.crm_legacy_opportunity_v1(text,text,jsonb);
DROP TABLE public.crm_legacy_opportunity_commands;
NOTIFY pgrst,'reload schema';
COMMIT;
