-- First restore the L06 frontend and person_360 function. No business data rollback.
-- Keep commands and receipts for audit; never drop or rename existing objects.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.crm_recycle_batch_v1(text,text,jsonb)'::regprocedure)
    IS DISTINCT FROM 'fd520bea2c7a296e09dde6248461529d' THEN RAISE EXCEPTION 'L07 routine changed; reassess rollback'; END IF;
END $guard$;
REVOKE ALL ON FUNCTION public.crm_recycle_batch_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE INSERT,UPDATE ON public.crm_recycle_commands FROM service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
