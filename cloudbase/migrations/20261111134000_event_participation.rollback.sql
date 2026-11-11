BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.activity_participant_responses IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.activity_participant_responses) THEN RAISE EXCEPTION 'Recorded participant responses require a reviewed data recovery plan'; END IF;
END $guard$;
DROP FUNCTION public.crm_event_participation_v1(text,text,jsonb);
DROP TABLE public.activity_participant_responses;
NOTIFY pgrst,'reload schema';
COMMIT;
