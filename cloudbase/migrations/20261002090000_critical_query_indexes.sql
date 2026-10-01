-- WP 13.2: indexes for existing customer page/detail read paths.
-- These indexes contain only active rows and do not change query results.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.idx_followups_active_customer_date_id') IS NOT NULL
    OR to_regclass('public.idx_gifts_active_customer_date_id') IS NOT NULL
    OR to_regclass('public.idx_photos_active_customer_sort_id') IS NOT NULL THEN
    RAISE EXCEPTION 'WP 13.2 index name already exists; inspect before applying';
  END IF;
END $guard$;

CREATE INDEX idx_followups_active_customer_date_id
  ON public.followups (customer_id, followup_date DESC NULLS LAST, "Id" DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_gifts_active_customer_date_id
  ON public.gifts (customer_id, given_date DESC NULLS LAST, "Id" DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_photos_active_customer_sort_id
  ON public.photos (customer_id, sort_order ASC NULLS LAST, id ASC)
  WHERE deleted_at IS NULL;

COMMIT;
