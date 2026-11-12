-- Restore the PC28 executor grants; redeploy Assistant source to restore its entry points.
BEGIN;
SET LOCAL lock_timeout = '5s';
GRANT INSERT, UPDATE ON public.assistant_recruit_delete_commands TO service_role;
REVOKE ALL ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) TO service_role;
COMMIT;
