BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
DO $rollback$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgcrypto' AND e.extversion='1.3' AND n.nspname='public'
      AND obj_description(e.oid,'pg_extension')='Installed by CRM migration 20261111234500 for activity registration'
  ) THEN RAISE EXCEPTION 'pgcrypto ownership or version differs; review rollback'; END IF;
END $rollback$;
-- Roll back registration dependants first. A dependency aborts this transaction.
DROP EXTENSION pgcrypto RESTRICT;
COMMIT;
