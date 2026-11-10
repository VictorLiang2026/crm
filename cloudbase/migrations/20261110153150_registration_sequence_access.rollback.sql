-- Restores the explicit grants observed before the cutover. Does not reset counters.
BEGIN;
SET LOCAL lock_timeout='4s';
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.activity_registration_people_id_seq, public.activity_registration_audit_id_seq TO anon, authenticated;
COMMIT;
