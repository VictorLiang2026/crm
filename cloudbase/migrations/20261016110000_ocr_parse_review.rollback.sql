-- PC14 rollback is intentionally blocked after any command preview has been recorded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
  IF to_regclass('public.crm_ocr_parse_commands') IS NOT NULL AND
     EXISTS (SELECT 1 FROM public.crm_ocr_parse_commands) THEN
    RAISE EXCEPTION 'PC14 OCR review command history exists; preserve audit data and roll back code first';
  END IF;
END $guard$;
DROP FUNCTION IF EXISTS public.crm_ocr_parse_execute_v1(text,uuid);
DROP FUNCTION IF EXISTS public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid);
DROP FUNCTION IF EXISTS public.crm_ocr_parse_preview_v1(text,uuid,bigint,integer,bigint,jsonb);
DROP TABLE IF EXISTS public.crm_ocr_parse_commands;
COMMIT;
