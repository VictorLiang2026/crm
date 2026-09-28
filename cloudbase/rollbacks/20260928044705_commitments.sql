-- Manual rollback only; never erase recorded promises.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.commitments IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.commitments LIMIT 1) THEN
    RAISE EXCEPTION 'commitments rollback refused: commitment data exists';
  END IF;
END $guard$;
DROP TABLE public.commitments RESTRICT;
DROP FUNCTION public.commitments_guard() RESTRICT;
COMMIT;
