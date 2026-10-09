-- PMC-14 postcheck: verify canonical backfill state for activity_participants.
-- Run BEFORE migration (baseline) and AFTER migration (expected: grp1_ok=2, grp89_ok=5,
-- still_pending=0, alive counters unchanged from baseline).
SELECT
  count(*) FILTER (WHERE ap.id IN (1,2)   AND ap.person_type='customer' AND ap.deleted_at IS NOT NULL AND ap.canonical_person_id = 1)  AS grp1_ok,
  count(*) FILTER (WHERE ap.id IN (3,5,7,9,11) AND ap.person_type='customer' AND ap.deleted_at IS NOT NULL AND ap.canonical_person_id = 89) AS grp89_ok,
  count(*) FILTER (WHERE ap.person_type='customer' AND ap.deleted_at IS NOT NULL AND ap.canonical_person_id IS NULL) AS still_pending,
  count(*) FILTER (WHERE ap.deleted_at IS NULL)                                        AS alive_rows,
  count(*) FILTER (WHERE ap.deleted_at IS NULL AND ap.person_id IS NOT NULL AND ap.canonical_person_id IS NULL) AS alive_pid_no_canonical,
  count(*) FILTER (WHERE ap.deleted_at IS NULL AND ap.canonical_person_id IS NOT NULL) AS alive_canonical,
  count(*) FILTER (WHERE ap.deleted_at IS NOT NULL AND ap.person_type='customer' AND ap.canonical_person_id IS NOT NULL) AS softdel_customer_canonical
FROM public.activity_participants ap;
