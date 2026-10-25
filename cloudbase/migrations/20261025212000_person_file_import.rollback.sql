-- Restore the prior application/frontend before disabling standalone imports.
-- Keep originals, audit commands, nullable columns and the legacy projection/filter.
-- Reinstating NOT NULL would reject retained standalone records, so is intentionally not attempted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='crm_person_file_v1' AND p.oid='public.crm_person_file_v1(text,text,jsonb)'::regprocedure)
     IS DISTINCT FROM '071d92cd5962ec66543b2e3528e4484a' THEN RAISE EXCEPTION 'L04b function changed; reassess rollback'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.crm_person_file_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'Person file imports disabled by L04b rollback'; END $fn$;
REVOKE ALL ON FUNCTION public.crm_person_file_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_person_file_v1(text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

