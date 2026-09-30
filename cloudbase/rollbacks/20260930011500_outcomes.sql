-- Manual rollback only. Refuse to erase outcome records or dependent objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.outcomes IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.outcomes LIMIT 1) THEN
    RAISE EXCEPTION 'outcomes rollback refused: outcome data exists';
  END IF;
END $guard$;
DROP TABLE public.outcomes RESTRICT;
COMMIT;
