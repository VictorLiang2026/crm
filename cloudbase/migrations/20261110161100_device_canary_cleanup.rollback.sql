-- Ephemeral synthetic fixture only. No customer object or general bucket policy is touched.
BEGIN;
SET LOCAL lock_timeout='4s';
-- Only restore during an explicit rerun for the same synthetic test account and objects.
DO $$ BEGIN IF current_setting('crm_security.restore_synthetic_canary',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Synthetic canary rollback requires explicit opt-in'; END IF; END $$;
CREATE POLICY crm_cutover_fixture_1794287223_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id IN ('recruit','knowledge') AND name='2120020390101196801/device-cutover-cutover1794287223/transport.txt' AND auth.uid()='2120020390101196801'); CREATE POLICY crm_cutover_fixture_1794287223_del ON storage.objects FOR DELETE TO authenticated USING (bucket_id IN ('recruit','knowledge') AND name='2120020390101196801/device-cutover-cutover1794287223/transport.txt' AND auth.uid()='2120020390101196801');
COMMIT;
