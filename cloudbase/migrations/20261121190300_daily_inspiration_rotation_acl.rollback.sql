-- Preserve the service-only boundary if this hardening migration is rolled back.
-- The rotation table is introduced by 20261121190000 and its rollback drops it.
BEGIN;
REVOKE ALL ON TABLE public.daily_inspiration_rotation_used FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_inspiration_rotation_used TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
