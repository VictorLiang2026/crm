-- PC32 activity review: hold the registered, already executed fictional command.
DO $test$
BEGIN
  PERFORM id FROM public.crm_activity_review_commands
    WHERE id='ce61aceb-b79b-4798-a9aa-440bde1de6ee'::uuid
      AND actor_uid='2102162853214060545' AND activity_id=11
      AND executed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PC32 registered activity command changed'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crm.pc32:activity-review:ce61aceb-b79b-4798-a9aa-440bde1de6ee',0));
  PERFORM pg_catalog.pg_sleep(12);
END $test$;
