BEGIN;
SET LOCAL lock_timeout='5s';
-- Disable the two entry points before rollback. Keep existing business records and audit.
DROP FUNCTION public.crm_registration_staff_v1(text,text),public.crm_registration_public_v1(text,text);
DROP FUNCTION public.crm_registration_handle_v1(text,text,text);
DROP FUNCTION public.crm_registration_staff_data_v1(text,jsonb,text),public.crm_registration_public_data_v1(text,jsonb);
DO $guard$ BEGIN
  IF EXISTS(SELECT FROM public.activity_registration_signers WHERE enabled)
   OR EXISTS(SELECT FROM public.activity_registration_receipts WHERE expires_at>clock_timestamp())
   THEN RAISE EXCEPTION 'Disable both signers and allow retry receipts to expire before rollback'; END IF;
END $guard$;
DROP TABLE public.activity_registration_receipts,public.activity_registration_nonces,public.activity_registration_signers;
COMMIT;
