BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='knowledge_sources')
     OR EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='knowledge_sources' AND column_name='original_base64') THEN
    RAISE EXCEPTION 'Knowledge source original storage precondition failed';
  END IF;
END $guard$;

ALTER TABLE public.knowledge_sources ADD COLUMN original_base64 text;
ALTER TABLE public.knowledge_sources ADD CONSTRAINT knowledge_sources_original_size_check
  CHECK (original_base64 IS NULL OR length(original_base64) <= 4194304);
ALTER TABLE public.knowledge_sources ADD CONSTRAINT knowledge_sources_original_name_check
  CHECK ((original_base64 IS NULL) = (file_name IS NULL));

COMMIT;
