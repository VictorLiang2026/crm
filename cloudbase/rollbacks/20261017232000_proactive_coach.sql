-- PC30 rollback refuses to discard operator decisions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_proactive_coach_decisions) THEN
    RAISE EXCEPTION 'PC30 decisions exist; export and review before rollback';
  END IF;
END
$guard$;
DROP FUNCTION public.crm_proactive_coach_decision_v1(text,uuid,bigint,text,bigint,text,integer,bigint);
DROP TABLE public.crm_proactive_coach_decisions;
COMMIT;
