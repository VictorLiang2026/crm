-- Restore the L00 frontend and person_360 first; retain this additive object and its
-- service-only permission baseline. No table, view, old routine or business data changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.person_customer_worklist_v1(p_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Customer worklist is disabled';
END
$function$;
REVOKE ALL ON FUNCTION public.person_customer_worklist_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_customer_worklist_v1(jsonb) TO service_role;
COMMIT;
