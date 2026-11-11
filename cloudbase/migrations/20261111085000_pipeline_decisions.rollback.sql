BEGIN;
LOCK TABLE public.crm_pipeline_decisions IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_pipeline_decisions WHERE confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Confirmed pipeline history exists. Export and reconcile before structural rollback.';
  END IF;
END
$guard$;
DROP FUNCTION public.crm_pipeline_stage_v1(text,text,jsonb);
DROP TABLE public.crm_pipeline_decisions;
COMMIT;
