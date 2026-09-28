-- Manual rollback only. Refuse to erase action records or dependent objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.actions IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.actions LIMIT 1) THEN
    RAISE EXCEPTION 'actions rollback refused: action data exists';
  END IF;
END $guard$;
DROP TABLE public.actions RESTRICT;
DROP FUNCTION public.actions_guard() RESTRICT;
COMMIT;
