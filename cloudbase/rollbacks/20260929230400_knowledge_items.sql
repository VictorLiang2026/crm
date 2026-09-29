-- Manual rollback only. Refuse to discard catalog records or dependent objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.knowledge_items IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.knowledge_items LIMIT 1) THEN
    RAISE EXCEPTION 'knowledge_items rollback refused: knowledge data exists';
  END IF;
END $guard$;
DROP TABLE public.knowledge_items RESTRICT;
COMMIT;
