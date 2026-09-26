-- Manual rollback. Never drop a ledger containing captured interactions.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.interactions IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.interactions LIMIT 1) THEN
    RAISE EXCEPTION 'interactions rollback refused: interaction data exists';
  END IF;
END $guard$;
DROP TABLE public.interactions RESTRICT;
COMMIT;
