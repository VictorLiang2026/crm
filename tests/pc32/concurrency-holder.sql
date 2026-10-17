-- Independent session A: synthetic key only; no business row is written.
DO $test$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crm.learning:00000000-0000-4000-8000-000000032099',0));
  PERFORM pg_catalog.pg_sleep(12);
END;
$test$;
