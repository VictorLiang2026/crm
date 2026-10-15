-- PC08 rollback is refused after an executed family change to retain its audit and data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_household_commands WHERE status='executed') OR
     EXISTS (SELECT 1 FROM public.households
       WHERE important_facts_confirmed_at IS NOT NULL OR important_facts_confirmed_by_uid IS NOT NULL) THEN
    RAISE EXCEPTION 'PC08 rollback refused: confirmed family changes exist; preserve audit and evaluate forward repair';
  END IF;
END $guard$;

DROP FUNCTION public.crm_household_execute_v1(text,uuid);
DROP FUNCTION public.crm_household_preview_v1(text,uuid,bigint,text,jsonb);
DROP TABLE public.crm_household_commands;
ALTER TABLE public.households
  DROP COLUMN important_facts_confirmed_by_uid,
  DROP COLUMN important_facts_confirmed_at;
COMMIT;
