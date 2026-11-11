BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.crm_advice_feedback IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_advice_feedback WHERE confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Export and retain confirmed feedback before rolling back';
  END IF;
END $$;
DROP FUNCTION public.crm_advice_feedback_v1(text,text,jsonb);
DROP TABLE public.crm_advice_feedback;
COMMIT;
