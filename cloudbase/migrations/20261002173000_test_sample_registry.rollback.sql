-- Redeploy the previous function/page artifacts first. Never delete a populated registry.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM public.crm_test_batches) OR EXISTS (SELECT 1 FROM public.crm_test_records) THEN
   RAISE EXCEPTION 'Registry is populated; preserve IDs and assess a separate rollback';
 END IF;
END $guard$;
DROP FUNCTION public.crm_test_disclosure_v1(jsonb,text);
DROP TABLE public.crm_test_records;
DROP TABLE public.crm_test_batches;
COMMIT;

