BEGIN;
SET LOCAL lock_timeout='5s';
DROP FUNCTION public.crm_activity_registration_write_v1(text,jsonb);
COMMIT;
