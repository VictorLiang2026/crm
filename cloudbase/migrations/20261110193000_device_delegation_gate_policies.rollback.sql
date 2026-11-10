-- Emergency rollback only. Apply only before deploying service-role callers.
BEGIN;
SET LOCAL lock_timeout='4s';

REVOKE SELECT ON public.crm_device_delegations,public.crm_device_file_parts,public.crm_device_file_uploads FROM service_role;
DROP POLICY crm_device_delegations_service_select ON public.crm_device_delegations;
DROP POLICY crm_device_file_parts_service_select ON public.crm_device_file_parts;
DROP POLICY crm_device_file_uploads_service_select ON public.crm_device_file_uploads;
REVOKE EXECUTE ON FUNCTION public.crm_device_delegate_v1(text,jsonb) FROM service_role;

COMMIT;
