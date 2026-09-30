-- Manual rollback. Refuse to erase command audit or executed Action links.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.assistant_action_commands LIMIT 1) THEN
    RAISE EXCEPTION 'Assistant Action commands exist; assess audit and business data before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text) RESTRICT;
DROP TABLE public.assistant_action_commands RESTRICT;
COMMIT;
