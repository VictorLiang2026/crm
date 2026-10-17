-- PC32-B: lock an existing registered fictional candidate, then publish a marker.
DO $test$
BEGIN
  PERFORM id FROM public.opportunity_candidates
    WHERE id=3 AND person_id=783 AND status='created' AND opportunity_id=10
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PC32-B fictional candidate changed'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm.pc32b:opportunity_candidate:3',0));
  PERFORM pg_catalog.pg_sleep(12);
END;
$test$;
