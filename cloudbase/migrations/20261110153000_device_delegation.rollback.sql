BEGIN;
SET LOCAL lock_timeout='4s';
LOCK TABLE public.crm_device_delegations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT FROM public.crm_device_delegations WHERE expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Active calls: drain before rollback'; END IF; END $$;
DROP FUNCTION public.crm_device_delegate_v1(text,jsonb);
DROP TABLE public.crm_device_delegations;
COMMIT;
