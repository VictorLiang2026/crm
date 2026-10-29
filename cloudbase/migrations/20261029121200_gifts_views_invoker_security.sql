BEGIN;
SET LOCAL lock_timeout = '5s';

-- Replacing a view definition reset its existing reloptions on CloudBase PG.
-- Restore the pre-existing caller-RLS behavior for the affected public views.
ALTER VIEW public.ai_recommendations_view SET (security_invoker = true);
ALTER VIEW public.customers_view SET (security_invoker = true);
ALTER VIEW public.followups_view SET (security_invoker = true);
ALTER VIEW public.gifts_view SET (security_invoker = true);
ALTER VIEW public.products_view SET (security_invoker = true);

COMMIT;
