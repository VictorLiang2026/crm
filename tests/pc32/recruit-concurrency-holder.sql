-- PC32 recruit: lock one registered fictional candidate, then expose a marker.
DO $test$
BEGIN
  PERFORM id FROM public.recruit_candidates
    WHERE id=19 AND person_id=784 AND stage='新增人才' AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PC32 registered recruit fixture changed'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm.pc32:recruit:19',0));
  PERFORM pg_catalog.pg_sleep(12);
END $test$;
