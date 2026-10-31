BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.person_followup_advice IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.person_followup_advice) THEN
    RAISE EXCEPTION 'Follow-up advice or pending GPT previews exist; rollback would discard user data';
  END IF;
END $guard$;

REVOKE ALL ON TABLE public.person_followup_advice FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.person_followup_advice_id_seq FROM PUBLIC, anon, authenticated, service_role;
DROP TABLE public.person_followup_advice;

COMMIT;
