-- Manual rollback refuses to erase candidate audit or formal Opportunity links.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.opportunity_candidates LIMIT 1) THEN
    RAISE EXCEPTION 'Opportunity candidates exist; assess audit and created Opportunities before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.opportunity_candidate_v1(text,text,bigint,bigint,bigint,jsonb,jsonb,text) RESTRICT;
DROP TABLE public.opportunity_candidates RESTRICT;
COMMIT;
