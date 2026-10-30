-- CREATE OR REPLACE VIEW resets omitted reloptions. Restore the existing caller-RLS boundary.
BEGIN;
ALTER VIEW public.followups_view SET (security_invoker=true);
NOTIFY pgrst,'reload schema';
COMMIT;
