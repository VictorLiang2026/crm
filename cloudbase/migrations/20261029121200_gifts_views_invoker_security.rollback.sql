BEGIN;
SET LOCAL lock_timeout = '5s';

-- The safe pre-WP02 view contract also used security_invoker=true.
ALTER VIEW public.ai_recommendations_view SET (security_invoker = true);
ALTER VIEW public.customers_view SET (security_invoker = true);
ALTER VIEW public.followups_view SET (security_invoker = true);
ALTER VIEW public.gifts_view SET (security_invoker = true);
ALTER VIEW public.products_view SET (security_invoker = true);

COMMIT;
