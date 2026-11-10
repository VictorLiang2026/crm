BEGIN;
SET LOCAL lock_timeout='4s';

GRANT SELECT ON public.crm_device_delegations,public.crm_device_file_parts,public.crm_device_file_uploads TO service_role;
CREATE POLICY crm_device_delegations_service_select ON public.crm_device_delegations FOR SELECT TO service_role USING (true);
CREATE POLICY crm_device_file_parts_service_select ON public.crm_device_file_parts FOR SELECT TO service_role USING (true);
CREATE POLICY crm_device_file_uploads_service_select ON public.crm_device_file_uploads FOR SELECT TO service_role USING (true);
GRANT EXECUTE ON FUNCTION public.crm_device_delegate_v1(text,jsonb) TO service_role;

COMMIT;
