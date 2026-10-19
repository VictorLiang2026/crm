-- Restrict the SECURITY DEFINER collector RPC to the CloudBase server role.
-- The PM18 caller is validated with pmc18_observer after this migration.
REVOKE ALL ON FUNCTION public.pmc18_collect_once_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pmc18_collect_once_v1() TO service_role;
