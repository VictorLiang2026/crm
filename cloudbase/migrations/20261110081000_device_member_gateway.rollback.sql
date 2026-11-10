-- Roll back the application transport first. Registry and any approved devices are preserved.
BEGIN;
SET LOCAL lock_timeout='4s';
DROP FUNCTION public.crm_device_member_gateway_v1(text,text,text,jsonb);
COMMIT;
