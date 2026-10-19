-- Restore the observed pre-migration access for the existing PM18 serverless caller.
REVOKE ALL ON FUNCTION public.pmc18_collect_once_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pmc18_collect_once_v1() TO anon;
