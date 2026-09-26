-- Manual rollback only. Never erase relationship history silently.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.relationships IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.relationships LIMIT 1) THEN
    RAISE EXCEPTION 'relationships rollback refused: table contains records';
  END IF;
END $guard$;
DROP TABLE public.relationships RESTRICT;
COMMIT;
