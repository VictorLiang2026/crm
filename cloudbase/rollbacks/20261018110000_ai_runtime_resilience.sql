-- PC33 rollback: do not discard an AI request receipt with production history.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_request_claims) THEN
    RAISE EXCEPTION 'AI request claims exist; assess task/result history before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean);
DROP FUNCTION public.crm_ai_claim_v1(text,text,text,text,text,text,text,jsonb,jsonb);
DROP TABLE public.ai_request_claims;
COMMIT;
