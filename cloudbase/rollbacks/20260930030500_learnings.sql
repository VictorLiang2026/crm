-- Manual rollback only. Refuse to erase learning records or dependent objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.learnings IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.learnings LIMIT 1) THEN
    RAISE EXCEPTION 'learnings rollback refused: learning data exists';
  END IF;
END $guard$;
DROP TABLE public.learnings RESTRICT;
DROP FUNCTION public.learnings_guard() RESTRICT;
COMMIT;
