-- Roll back only after device upload callers are reverted. Refuse to discard
-- staged file data; no CASCADE is used.
BEGIN;
SET LOCAL lock_timeout='4s';

DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM public.crm_device_file_uploads) OR
    EXISTS (SELECT 1 FROM public.crm_device_file_parts) THEN
  RAISE EXCEPTION 'Device upload rows exist; finish or remove them before rollback';
 END IF;
END
$guard$;

REVOKE ALL ON FUNCTION public.crm_device_file_stage_v1(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.crm_device_file_stage_v1(text,text,text,jsonb);
DROP TABLE public.crm_device_file_parts;
DROP TABLE public.crm_device_file_uploads;

COMMIT;
