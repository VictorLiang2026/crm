-- PC09 rollback. Deliberately preserve data: stop if any command ran or importance is populated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_relationship_commands WHERE status='executed') OR
    EXISTS(SELECT 1 FROM public.relationships WHERE importance IS NOT NULL) THEN
   RAISE EXCEPTION 'PC09 rollback blocked: relationship commands or importance data exist; assess and preserve data first';
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public.crm_relationship_preview_v1(text,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_relationship_execute_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.crm_relationship_preview_v1(text,uuid,bigint,text,jsonb);
DROP FUNCTION public.crm_relationship_execute_v1(text,uuid);
DROP TABLE public.crm_relationship_commands;
ALTER TABLE public.relationships DROP CONSTRAINT relationships_importance_range, DROP COLUMN importance;
COMMIT;
