-- Ephemeral synthetic fixture only. No customer object or general bucket policy is touched.
BEGIN;
SET LOCAL lock_timeout='4s';
DROP POLICY IF EXISTS crm_cutover_fixture_1794287223_read ON storage.objects; DROP POLICY IF EXISTS crm_cutover_fixture_1794287223_del ON storage.objects;
COMMIT;
