BEGIN;
REVOKE EXECUTE ON FUNCTION public.crm_test_track_v1() FROM service_role;
COMMIT;
