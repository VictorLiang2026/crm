-- Roll back only after the compatible device-callers have been reverted and
-- later permission hardening migrations have been rolled back in reverse order.
BEGIN;
SET LOCAL lock_timeout='4s';

DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM public.crm_device_delegations) THEN
  RAISE EXCEPTION 'Device delegation rows exist; inspect and expire them before rollback';
 END IF;
END
$guard$;

REVOKE ALL ON FUNCTION public.crm_device_delegate_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.crm_device_delegate_v1(text,jsonb);
DROP TABLE public.crm_device_delegations;

COMMIT;
