BEGIN;
SET LOCAL lock_timeout='4s';
DO $$ BEGIN
 IF pg_catalog.pg_get_serial_sequence('public.activity_registration_people','id') IS DISTINCT FROM 'public.activity_registration_people_id_seq'
 OR pg_catalog.pg_get_serial_sequence('public.activity_registration_audit','id') IS DISTINCT FROM 'public.activity_registration_audit_id_seq'
 THEN RAISE EXCEPTION 'Unexpected registration sequence ownership'; END IF;
END $$;
REVOKE SELECT, UPDATE, USAGE ON SEQUENCE public.activity_registration_people_id_seq, public.activity_registration_audit_id_seq FROM anon, authenticated;
COMMIT;
