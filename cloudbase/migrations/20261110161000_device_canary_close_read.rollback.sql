-- Ephemeral synthetic fixture only. No customer object or general bucket policy is touched.
BEGIN;
SET LOCAL lock_timeout='4s';
CREATE POLICY crm_cutover_fixture_1794287223_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id IN ('recruit','knowledge') AND name='2120020390101196801/device-cutover-cutover1794287223/transport.txt' AND auth.uid()='2120020390101196801');
COMMIT;
