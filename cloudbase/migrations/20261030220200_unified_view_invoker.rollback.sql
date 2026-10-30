-- The pre-change view was security_invoker=true. Application rollback retains that boundary.
BEGIN;
ALTER VIEW public.followups_view SET (security_invoker=true);
NOTIFY pgrst,'reload schema';
COMMIT;
