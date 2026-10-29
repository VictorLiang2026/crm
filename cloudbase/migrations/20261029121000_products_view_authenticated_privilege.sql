BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE ALL PRIVILEGES ON public.products_view FROM authenticated;
COMMIT;
