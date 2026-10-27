BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.knowledge_sources') IS NULL
     OR to_regprocedure('public.crm_knowledge_ocr_input_v1(bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Knowledge OCR input precondition failed';
  END IF;
END $guard$;

CREATE FUNCTION public.crm_knowledge_ocr_input_v1(p_source_id bigint, p_upload_id uuid)
RETURNS TABLE(file_name text, content_type text, original_base64 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_source_id IS NULL OR p_source_id < 1 OR p_upload_id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_UNAVAILABLE';
  END IF;

  RETURN QUERY
  SELECT s.file_name, s.content_type, s.original_base64
  FROM public.knowledge_sources AS s
  WHERE s.id = p_source_id
    AND s.deleted_at IS NULL
    AND s.extraction_status = 'extracting'
    AND s.metadata->'upload'->>'phase' = 'complete'
    AND s.metadata->'upload'->>'upload_id' = p_upload_id::text
    AND s.content_type IN ('image/png','image/jpeg','image/webp')
    AND s.file_size_bytes BETWEEN 1 AND 6291456
    AND s.original_base64 IS NOT NULL
    AND length(s.original_base64) <= 8388608;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOURCE_UNAVAILABLE';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_knowledge_ocr_input_v1(bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_ocr_input_v1(bigint,uuid) TO anon;
COMMENT ON FUNCTION public.crm_knowledge_ocr_input_v1(bigint,uuid)
  IS 'Returns a staged image only for OCR when the source ID and upload capability token match.';

COMMIT;
