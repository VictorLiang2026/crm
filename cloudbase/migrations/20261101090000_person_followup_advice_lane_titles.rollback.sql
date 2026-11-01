BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.person_followup_advice IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.person_followup_advice
    WHERE system_title IS DISTINCT FROM title OR gpt_title IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Independent follow-up advice titles contain data; rollback would discard user changes';
  END IF;
END $guard$;

ALTER TABLE public.person_followup_advice
  DROP COLUMN gpt_title,
  DROP COLUMN system_title;

COMMIT;
