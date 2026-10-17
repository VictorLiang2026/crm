-- PC32 activity review: the actual replay RPC must wait on its command row.
DO $test$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','500ms',true);
  BEGIN
    PERFORM public.crm_activity_review_execute_v1(
      '2102162853214060545','ce61aceb-b79b-4798-a9aa-440bde1de6ee'::uuid);
  EXCEPTION WHEN SQLSTATE '55P03' THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 activity replay did not wait on command'; END IF;
END $test$;
