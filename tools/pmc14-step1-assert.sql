-- PMC-14 migration 20261009180000 step 1/2 (split for `tcb db execute` single-statement
-- channel; BEGIN/COMMIT/SET LOCAL omitted per PMC-05 precedent — the step-2 UPDATE is a
-- single atomic statement and re-checks every row condition on its own).
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
