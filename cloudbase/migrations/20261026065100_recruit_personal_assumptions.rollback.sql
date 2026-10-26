-- Restore the previous frontend and recruit_goals artifact first.
-- Disable only the new atomic endpoint; keep all personal assumptions and the old save path.
BEGIN;
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_recruit_benchmarks_save_v1'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)='p_rows jsonb'
     AND pg_catalog.md5(p.prosrc)='8de86662a52fb2e90e1c202e6089d386') THEN
  RAISE EXCEPTION 'L06 rollback baseline differs; inspect before continuing';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.crm_recruit_benchmarks_save_v1(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s'
AS $disabled$
BEGIN
 RAISE EXCEPTION 'Personal assumptions atomic save is disabled';
END $disabled$;
REVOKE ALL ON FUNCTION public.crm_recruit_benchmarks_save_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
