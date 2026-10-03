-- WP03 continuation: align the private trigger with existing service-only guards.
BEGIN;
GRANT EXECUTE ON FUNCTION public.crm_test_track_v1() TO service_role;
COMMIT;
