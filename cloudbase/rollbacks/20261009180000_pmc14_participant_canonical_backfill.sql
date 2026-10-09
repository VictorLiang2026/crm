-- PMC-14 rollback: revert exactly the rows written by migration 20261009180000.
-- Mapping captured from read-only probe pmc14-q9-backfill-map.json before the migration:
--   ap id 1,2  -> person 1   (legacy_customer_id 1)
--   ap id 3,5,7,9,11 -> person 89 (legacy_customer_id 91)
-- Only clears canonical_person_id when it still equals the value this migration wrote,
-- and only on soft-deleted customer rows, so later manual confirmations survive.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

UPDATE public.activity_participants
SET canonical_person_id = NULL
WHERE person_type = 'customer'
  AND deleted_at IS NOT NULL
  AND (
    (id IN (1, 2)   AND canonical_person_id = 1)
    OR
    (id IN (3, 5, 7, 9, 11) AND canonical_person_id = 89)
  );

COMMIT;
