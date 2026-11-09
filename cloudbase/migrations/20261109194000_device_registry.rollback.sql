-- Snapshot registry separately before removing a configured deployment. Never drop an approved device on rollback.
BEGIN;
SET LOCAL lock_timeout='4s';
LOCK TABLE public.crm_access_members,public.crm_browser_devices,public.crm_device_challenges IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM public.crm_access_members) OR EXISTS(SELECT FROM public.crm_browser_devices) OR EXISTS(SELECT FROM public.crm_device_challenges) THEN RAISE EXCEPTION 'Registry in use: preserve approvals and stop rollback'; END IF;
END $guard$;
DROP FUNCTION public.crm_device_gateway_v1(text,text,text,jsonb);
DROP TABLE public.crm_device_challenges;
DROP TABLE public.crm_browser_devices;
DROP FUNCTION public.crm_device_state_changed_v1();
DROP TABLE public.crm_access_members;
DROP FUNCTION public.crm_member_disabled_v1();
COMMIT;
