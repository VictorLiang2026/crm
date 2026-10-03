-- WP07 rollback is safe only before any command has executed; preserve business IDs otherwise.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.quick_capture_v2_commands WHERE status='executed') THEN
    RAISE EXCEPTION 'Executed WP07 records require a separately reviewed data rollback';
  END IF;
END $guard$;
DROP FUNCTION public.quick_capture_v2_command_v1(text,text,uuid,bigint,text,jsonb,text,bigint,bigint) RESTRICT;
DROP TABLE public.quick_capture_v2_commands RESTRICT;
COMMIT;
