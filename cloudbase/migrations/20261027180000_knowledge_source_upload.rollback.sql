BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_sources') IS NULL
     OR EXISTS (SELECT 1 FROM public.knowledge_sources WHERE metadata->'upload'->>'phase'='receiving')
     OR EXISTS (SELECT 1 FROM public.knowledge_sources WHERE file_size_bytes > 3145728)
     OR EXISTS (SELECT 1 FROM public.knowledge_sources WHERE original_base64 IS NOT NULL AND length(original_base64) > 4194304) THEN
    RAISE EXCEPTION 'Cannot restore the 3 MiB constraints while larger knowledge sources exist';
  END IF;
END $guard$;

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT knowledge_sources_file_size_bytes_check,
  DROP CONSTRAINT knowledge_sources_original_size_check;

ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_file_size_bytes_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 3145728),
  ADD CONSTRAINT knowledge_sources_original_size_check
    CHECK (original_base64 IS NULL OR length(original_base64) <= 4194304);

COMMENT ON CONSTRAINT knowledge_sources_file_size_bytes_check ON public.knowledge_sources
  IS 'Knowledge source upload limit: 3 MiB.';
COMMENT ON CONSTRAINT knowledge_sources_original_size_check ON public.knowledge_sources
  IS 'Private original Base64 storage size limit.';

COMMIT;
