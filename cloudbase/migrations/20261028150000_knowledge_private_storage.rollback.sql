BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_sources') IS NULL
     OR EXISTS (SELECT 1 FROM public.knowledge_sources
       WHERE file_size_bytes>6291456 OR (file_name IS NOT NULL AND original_base64 IS NULL))
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='knowledge') THEN
    RAISE EXCEPTION 'Cannot roll back while CloudBase-stored knowledge files or files over 6 MiB exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='knowledge')
     OR to_regprocedure('public.crm_knowledge_storage_ocr_input_v1(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Knowledge storage rollback precondition failed';
  END IF;
END $guard$;

DROP FUNCTION public.crm_knowledge_storage_ocr_input_v1(bigint,uuid);
DROP POLICY knowledge_objects_select_own ON storage.objects;
DROP POLICY knowledge_objects_insert_own ON storage.objects;
DROP POLICY knowledge_objects_update_own ON storage.objects;
DROP POLICY knowledge_objects_delete_own ON storage.objects;
DELETE FROM storage.buckets WHERE id='knowledge';

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT knowledge_sources_file_size_bytes_check,
  DROP CONSTRAINT knowledge_sources_original_name_check;
ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_file_size_bytes_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 6291456),
  ADD CONSTRAINT knowledge_sources_original_name_check
    CHECK ((original_base64 IS NULL) = (file_name IS NULL));
COMMENT ON CONSTRAINT knowledge_sources_file_size_bytes_check ON public.knowledge_sources
  IS 'Knowledge source upload limit: 6 MiB.';
COMMENT ON CONSTRAINT knowledge_sources_original_name_check ON public.knowledge_sources
  IS 'Legacy private original is Base64 text.';

COMMIT;
