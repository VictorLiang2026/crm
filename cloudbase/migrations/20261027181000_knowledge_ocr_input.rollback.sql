BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.crm_knowledge_ocr_input_v1(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Knowledge OCR input routine is missing';
  END IF;
END $guard$;

REVOKE ALL ON FUNCTION public.crm_knowledge_ocr_input_v1(bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.crm_knowledge_ocr_input_v1(bigint,uuid);

COMMIT;
