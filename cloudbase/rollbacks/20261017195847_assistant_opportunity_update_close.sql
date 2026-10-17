-- PC27 rollback: retain command/preview audit if any Assistant Opportunity command exists.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.assistant_opportunity_commands) THEN
    RAISE EXCEPTION 'PC27 command audit exists; preserve Assistant Opportunity command ledger';
  END IF;
END $rollback$;
REVOKE ALL ON FUNCTION public.assistant_opportunity_command_v1(text,text,uuid,uuid,bigint,bigint,text,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.assistant_opportunity_command_v1(text,text,uuid,uuid,bigint,bigint,text,jsonb,text);
DROP TABLE public.assistant_opportunity_commands;
NOTIFY pgrst,'reload schema';
COMMIT;
