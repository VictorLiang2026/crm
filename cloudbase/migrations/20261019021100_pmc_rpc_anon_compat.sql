-- Preserve the observed PM18 Cloud Function RDB caller, which runs as anon.
REVOKE ALL ON FUNCTION public.pmc18_collect_once_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pmc18_collect_once_v1() TO anon;
