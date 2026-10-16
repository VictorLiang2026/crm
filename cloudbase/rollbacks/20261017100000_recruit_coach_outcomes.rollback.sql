BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.outcomes WHERE ai_result_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot roll back Recruit Coach Outcome links while linked outcomes exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.crm_recruit_coach_outcome_commands
    WHERE status = 'executed' OR outcome_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot roll back executed Recruit Coach Outcome commands';
  END IF;
END $guard$;

DROP FUNCTION public.crm_recruit_coach_outcome_v1(text,text,uuid,bigint,bigint,bigint,jsonb,text);
DROP TABLE public.crm_recruit_coach_outcome_commands;
DROP INDEX public.outcomes_ai_result_idx;
ALTER TABLE public.outcomes DROP COLUMN ai_result_id;
COMMIT;
