-- PMC-14: backfill canonical_person_id for soft-deleted customer participant rows.
-- Rule (same bridge as 20260929084000, extended to soft-deleted rows per user approval 2026-10-09):
--   person_type='customer' AND person_id=customers."Id" resolves to exactly one live Person
--   via persons.legacy_customer_id; both sides soft-deleted rows are included.
-- Speaker rows without a resolvable Person and active name-only placeholder rows stay
--   "identity pending" — no guessed identities, no synthetic Persons.
-- idempotent: rows already carrying canonical_person_id are never touched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Assertion: every pending row resolves to exactly one live Person, and no
-- (activity_id, resolved person) pair occurs twice among the pending rows.
DO $assert$
DECLARE
  v_rows int;
  v_unique int;
  v_pairs int;
BEGIN
  SELECT count(*), count(p.id), count(DISTINCT (ap.activity_id, p.id))
    INTO v_rows, v_unique, v_pairs
  FROM public.activity_participants ap
  JOIN public.customers c ON c."Id" = ap.person_id AND c.deleted_at IS NULL
  JOIN public.persons p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
  WHERE ap.deleted_at IS NOT NULL
    AND ap.person_type = 'customer'
    AND ap.person_id IS NOT NULL
    AND ap.canonical_person_id IS NULL;
  IF v_rows <> v_unique OR v_rows <> v_pairs THEN
    RAISE EXCEPTION 'PMC-14 backfill assertion failed: rows=% unique=% pairs=% (ambiguous identity or same-activity duplicate)', v_rows, v_unique, v_pairs;
  END IF;
  IF v_rows = 0 THEN
    RAISE NOTICE 'PMC-14: nothing to backfill';
  ELSE
    RAISE NOTICE 'PMC-14: backfilling % rows', v_rows;
  END IF;
END
$assert$;

UPDATE public.activity_participants AS ap
SET canonical_person_id = p.id
FROM public.customers c
JOIN public.persons p ON p.legacy_customer_id = c."Id" AND p.deleted_at IS NULL
WHERE ap.deleted_at IS NOT NULL
  AND ap.person_type = 'customer'
  AND ap.person_id = c."Id"
  AND ap.canonical_person_id IS NULL
  AND c.deleted_at IS NULL
  AND (SELECT count(*) FROM public.persons x
       WHERE x.legacy_customer_id = c."Id" AND x.deleted_at IS NULL) = 1;

COMMIT;
