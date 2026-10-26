BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.knowledge_sources IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.knowledge_sources WHERE original_base64 IS NOT NULL) THEN
    RAISE EXCEPTION 'Private knowledge originals exist; rollback would discard uploaded files';
  END IF;
END $guard$;
ALTER TABLE public.knowledge_sources DROP CONSTRAINT knowledge_sources_original_size_check;
ALTER TABLE public.knowledge_sources DROP CONSTRAINT knowledge_sources_original_name_check;
ALTER TABLE public.knowledge_sources DROP COLUMN original_base64;
COMMIT;
