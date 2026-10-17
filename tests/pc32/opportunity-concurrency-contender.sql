-- PC32-B: the actual RPC must wait on the row, then reject cleanly.
DO $test$
DECLARE
  v_actor text;
  v_blocked boolean := false;
BEGIN
  SELECT reviewed_by_uid INTO v_actor FROM public.opportunity_candidates
    WHERE id=3 AND person_id=783 AND status='created' AND opportunity_id=10;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'PC32-B fictional confirming actor unavailable'; END IF;
  PERFORM pg_catalog.set_config('lock_timeout','500ms',true);
  BEGIN
    PERFORM public.opportunity_candidate_v1('execute',v_actor,3);
  EXCEPTION WHEN SQLSTATE '55P03' THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B contender did not wait on candidate row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opportunity_candidates
      WHERE id=3 AND status='created' AND opportunity_id=10) THEN
    RAISE EXCEPTION 'PC32-B contender changed candidate';
  END IF;
END;
$test$;
