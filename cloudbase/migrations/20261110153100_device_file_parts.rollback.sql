BEGIN;
SET LOCAL lock_timeout='4s';
LOCK TABLE public.crm_device_file_uploads IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT FROM public.crm_device_file_uploads WHERE expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Uploads active: drain before rollback'; END IF; END $$;
DROP FUNCTION public.crm_device_file_stage_v1(text,text,text,jsonb);
DROP TABLE public.crm_device_file_parts;
DROP TABLE public.crm_device_file_uploads;
COMMIT;
