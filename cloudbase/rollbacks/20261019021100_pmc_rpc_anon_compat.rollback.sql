-- Restore the service_role-only state introduced by migration 20261019020500.
REVOKE ALL ON FUNCTION public.pmc18_collect_once_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pmc18_collect_once_v1() TO service_role;
