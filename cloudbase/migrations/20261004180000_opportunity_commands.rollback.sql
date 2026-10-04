-- Safe only before any WP10 command has executed; never erase business/audit history silently.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_opportunity_commands WHERE status='executed') THEN
    RAISE EXCEPTION 'WP10 commands executed: assess linked Opportunity/Action/Outcome data before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.crm_opportunity_execute_v1(text,uuid);
DROP FUNCTION public.crm_opportunity_preview_v1(text,uuid,text,bigint,bigint,jsonb);
DROP TABLE public.crm_opportunity_commands;
COMMIT;
