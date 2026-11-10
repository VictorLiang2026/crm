BEGIN;
SET LOCAL lock_timeout='4s';
CREATE TABLE public.crm_knowledge_path_rotation (
 source_id bigint PRIMARY KEY, old_key text NOT NULL UNIQUE, new_key text NOT NULL UNIQUE, expected_bytes bigint NOT NULL CHECK(expected_bytes>0),
 phase text NOT NULL DEFAULT 'copy' CHECK(phase IN ('copy','linked','done','error')), lease uuid, lease_until timestamptz,
 last_error text, finished_at timestamptz, ready boolean NOT NULL DEFAULT false
);
ALTER TABLE public.crm_knowledge_path_rotation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_knowledge_path_rotation FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.crm_knowledge_path_rotation TO service_role;
CREATE POLICY crm_knowledge_rotation_service_read ON public.crm_knowledge_path_rotation FOR SELECT TO service_role USING(true);
-- Values are collected once, in this transaction. No real paths or document text go into Git.
INSERT INTO public.crm_knowledge_path_rotation(source_id,old_key,new_key,expected_bytes)
SELECT s.id,s.storage_key,regexp_replace(s.storage_key,'[^/]+$','')||gen_random_uuid()::text||'-'||regexp_replace(s.storage_key,'^.*/',''),s.file_size_bytes
FROM public.knowledge_sources s JOIN storage.objects o ON o.bucket_id='knowledge' AND o.name=s.storage_key
WHERE s.file_size_bytes=(o.metadata->>'size')::bigint AND s.metadata->'upload'->>'phase'='complete'
AND split_part(s.storage_key,'/',1)=s.created_by;
DO $$ BEGIN IF (SELECT count(*) FROM public.crm_knowledge_path_rotation)<>21
 OR (SELECT sum(expected_bytes) FROM public.crm_knowledge_path_rotation)<>140016191
 OR (SELECT count(*) FROM storage.objects WHERE bucket_id='knowledge')<>21
 OR EXISTS(SELECT FROM public.crm_knowledge_path_rotation r JOIN storage.objects o ON o.bucket_id='knowledge' AND o.name=r.new_key)
 THEN RAISE EXCEPTION 'Approved knowledge manifest changed'; END IF; END $$;
UPDATE public.crm_knowledge_path_rotation SET ready=true WHERE source_id=(SELECT min(source_id) FROM public.crm_knowledge_path_rotation);
CREATE FUNCTION public.crm_knowledge_path_rotation_v1(p_op text,p_id bigint DEFAULT NULL,p_lease uuid DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r public.crm_knowledge_path_rotation%ROWTYPE;
BEGIN
 IF p_op='claim' THEN
 IF EXISTS(SELECT FROM public.crm_knowledge_path_rotation WHERE phase='error') THEN RETURN '{}'::jsonb; END IF;
 SELECT * INTO r FROM public.crm_knowledge_path_rotation WHERE ready AND phase IN ('copy','linked') AND (lease IS NULL OR lease_until<clock_timestamp())
 ORDER BY source_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 UPDATE public.crm_knowledge_path_rotation SET lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes'
 WHERE source_id=r.source_id RETURNING * INTO r;
 RETURN to_jsonb(r);
 END IF;
 SELECT * INTO STRICT r FROM public.crm_knowledge_path_rotation WHERE source_id=p_id AND lease=p_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF p_op='link' AND r.phase='copy' THEN
 UPDATE public.knowledge_sources SET storage_key=r.new_key WHERE id=r.source_id AND storage_key=r.old_key AND file_size_bytes=r.expected_bytes AND metadata->'upload'->>'phase'='complete';
 IF NOT FOUND THEN RAISE EXCEPTION 'Reference changed'; END IF;
 UPDATE public.crm_knowledge_path_rotation SET phase='linked' WHERE source_id=r.source_id;
 ELSIF p_op='check' AND r.phase='linked' THEN
 IF NOT EXISTS(SELECT FROM public.knowledge_sources WHERE id=r.source_id AND storage_key=r.new_key AND file_size_bytes=r.expected_bytes)
 OR EXISTS(SELECT FROM public.knowledge_sources WHERE storage_key=r.old_key) THEN RAISE EXCEPTION 'Reference mismatch'; END IF;
 ELSIF p_op='done' AND r.phase='linked' THEN
 UPDATE public.crm_knowledge_path_rotation SET phase='done',lease=NULL,finished_at=clock_timestamp() WHERE source_id=r.source_id;
 ELSIF p_op='fail' THEN
 UPDATE public.crm_knowledge_path_rotation SET phase='error',last_error=left(p_error,100),lease=NULL WHERE source_id=r.source_id;
 ELSE RAISE EXCEPTION 'Invalid rotation phase'; END IF;
 RETURN '{"ok":true}'::jsonb;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_knowledge_path_rotation_v1(text,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_path_rotation_v1(text,bigint,uuid,text) TO service_role;
COMMIT;
