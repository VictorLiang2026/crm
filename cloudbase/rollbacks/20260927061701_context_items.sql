-- Manual rollback only. Refuse to erase context items or dependent objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.context_items IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.context_items LIMIT 1) THEN
    RAISE EXCEPTION 'context_items rollback refused: context data exists';
  END IF;
END $guard$;
DROP TABLE public.context_items RESTRICT;
DROP FUNCTION public.context_items_validate() RESTRICT;
COMMIT;
