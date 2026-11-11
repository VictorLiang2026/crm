BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';

-- Fail if another package already owns this extension. Review its ACLs separately.
CREATE EXTENSION pgcrypto WITH SCHEMA public VERSION '1.3';
COMMENT ON EXTENSION pgcrypto IS 'Installed by CRM migration 20261111234500 for activity registration';
DO $migration$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature, n.nspname, p.oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid
    JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid AND d.refclassid='pg_catalog.pg_extension'::regclass
    WHERE e.extname='pgcrypto' AND d.deptype='e'
  LOOP
    IF f.nspname <> 'public' THEN RAISE EXCEPTION 'Unexpected pgcrypto member schema'; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);
    IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
       OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected pgcrypto execution grant';
    END IF;
  END LOOP;
  IF to_regprocedure('public.hmac(bytea,bytea,text)') IS NULL THEN RAISE EXCEPTION 'HMAC missing'; END IF;
END $migration$;
COMMIT;
