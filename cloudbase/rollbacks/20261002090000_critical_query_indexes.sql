-- WP 13.2 rollback: remove only the three indexes created by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP INDEX IF EXISTS public.idx_photos_active_customer_sort_id;
DROP INDEX IF EXISTS public.idx_gifts_active_customer_date_id;
DROP INDEX IF EXISTS public.idx_followups_active_customer_date_id;

COMMIT;
