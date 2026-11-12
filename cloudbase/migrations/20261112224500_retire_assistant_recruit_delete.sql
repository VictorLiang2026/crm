-- Retire PC28 natural-language recruit deletion. Keep its executed audit row and table.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
REVOKE INSERT, UPDATE ON public.assistant_recruit_delete_commands FROM service_role;
REVOKE ALL ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
