-- Revert only M08 objects, never legacy photos/OCR or business data.
-- Once receipts exist, retain the additive schema and roll back code instead.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_file_import_jobs) THEN
   RAISE EXCEPTION 'File import receipts exist; retain schema and assess data before rollback';
 END IF;
END $guard$;
DROP FUNCTION public.crm_file_import_v1(text,text,jsonb);
DROP TABLE public.crm_file_import_jobs;
NOTIFY pgrst,'reload schema';
COMMIT;
