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
         AND c.conname='knowledge_sources_original_name_check'
     ) THEN
    RAISE EXCEPTION 'Knowledge attachment migration precondition failed';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='knowledge')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage'
       AND policyname IN ('knowledge_objects_select_own','knowledge_objects_insert_own',
         'knowledge_objects_update_own','knowledge_objects_delete_own'))
     OR to_regprocedure('public.crm_knowledge_storage_ocr_input_v1(bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Knowledge storage resources already exist; inspect before migration';
  END IF;
END $guard$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('knowledge','Knowledge Library',false,100000000,ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','text/markdown','text/csv','image/png','image/jpeg','image/webp'
]);

CREATE POLICY knowledge_objects_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id='knowledge' AND (storage.foldername(name))[1]=auth.uid());
CREATE POLICY knowledge_objects_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id='knowledge' AND (storage.foldername(name))[1]=auth.uid());
CREATE POLICY knowledge_objects_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id='knowledge' AND (storage.foldername(name))[1]=auth.uid())
  WITH CHECK (bucket_id='knowledge' AND (storage.foldername(name))[1]=auth.uid());
CREATE POLICY knowledge_objects_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id='knowledge' AND (storage.foldername(name))[1]=auth.uid());

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT knowledge_sources_file_size_bytes_check,
  DROP CONSTRAINT knowledge_sources_original_name_check;
ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_file_size_bytes_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 100000000),
  ADD CONSTRAINT knowledge_sources_original_name_check
    CHECK (original_base64 IS NULL OR file_name IS NOT NULL);
COMMENT ON CONSTRAINT knowledge_sources_file_size_bytes_check ON public.knowledge_sources
  IS 'CloudBase PG Knowledge object storage limit: 100,000,000 bytes.';
COMMENT ON CONSTRAINT knowledge_sources_original_name_check ON public.knowledge_sources
  IS 'Legacy Base64 originals require a file name; new originals reside in private CloudBase storage.';

CREATE FUNCTION public.crm_knowledge_storage_ocr_input_v1(p_source_id bigint,p_upload_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $fn$
DECLARE v_source public.knowledge_sources%ROWTYPE;
BEGIN
  IF p_source_id IS NULL OR p_source_id<1 OR p_upload_id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_UNAVAILABLE';
  END IF;
  SELECT * INTO v_source FROM public.knowledge_sources AS s
  WHERE s.id=p_source_id AND s.deleted_at IS NULL AND s.extraction_status='extracting'
    AND s.metadata->'upload'->>'phase'='complete'
    AND s.metadata->'upload'->>'upload_id'=p_upload_id::text
    AND s.metadata->'upload'->>'storage_bucket'='knowledge'
    AND s.content_type IN ('image/png','image/jpeg','image/webp')
    AND s.file_size_bytes BETWEEN 1 AND 100000000
    AND s.storage_key IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_UNAVAILABLE'; END IF;
  RETURN jsonb_build_object('file_name',v_source.file_name,'content_type',v_source.content_type,
    'storage_key',v_source.storage_key,'file_size_bytes',v_source.file_size_bytes);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_knowledge_storage_ocr_input_v1(bigint,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_storage_ocr_input_v1(bigint,uuid) TO service_role;
COMMENT ON FUNCTION public.crm_knowledge_storage_ocr_input_v1(bigint,uuid)
  IS 'Returns metadata for a staged private CloudBase image only while the matching source is being OCR-processed.';

COMMIT;
