BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_sources') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='public' AND t.relname='knowledge_sources'
         AND c.conname='knowledge_sources_file_size_bytes_check'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='public' AND t.relname='knowledge_sources'
         AND c.conname='knowledge_sources_original_size_check'
     ) THEN
    RAISE EXCEPTION 'Knowledge source size constraints are not at the expected baseline';
  END IF;
END $guard$;

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT knowledge_sources_file_size_bytes_check,
  DROP CONSTRAINT knowledge_sources_original_size_check;

ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_file_size_bytes_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 6291456),
  ADD CONSTRAINT knowledge_sources_original_size_check
    CHECK (original_base64 IS NULL OR length(original_base64) <= 8388608);

COMMENT ON CONSTRAINT knowledge_sources_file_size_bytes_check ON public.knowledge_sources
  IS 'Knowledge source upload limit: 6 MiB.';
COMMENT ON CONSTRAINT knowledge_sources_original_size_check ON public.knowledge_sources
  IS 'Private original is Base64 text; maximum encoded length for a 6 MiB file.';

COMMIT;
