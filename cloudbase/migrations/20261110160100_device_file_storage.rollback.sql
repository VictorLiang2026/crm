-- Dedicated recruit and knowledge buckets only. Run separately after proxy validation.
BEGIN;
SET LOCAL lock_timeout='4s';
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects' AND roles=ARRAY['service_role']::name[] AND policyname IN ('recruit_auth_rw','knowledge_objects_select_own','knowledge_objects_insert_own','knowledge_objects_update_own','knowledge_objects_delete_own') AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE ('%bucket_id = '''||CASE WHEN policyname='recruit_auth_rw' THEN 'recruit' ELSE 'knowledge' END||'''::text%'))<>5 THEN RAISE EXCEPTION 'Storage policy drift: stop and inspect'; END IF;
END $$;
ALTER POLICY recruit_auth_rw ON storage.objects TO authenticated;
ALTER POLICY knowledge_objects_select_own ON storage.objects TO authenticated;
ALTER POLICY knowledge_objects_insert_own ON storage.objects TO authenticated;
ALTER POLICY knowledge_objects_update_own ON storage.objects TO authenticated;
ALTER POLICY knowledge_objects_delete_own ON storage.objects TO authenticated;
COMMIT;
