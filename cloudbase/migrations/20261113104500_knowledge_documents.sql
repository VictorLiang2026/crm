BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.knowledge_sources, public.knowledge_items, public.playbooks IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.knowledge_documents (
 id bigint GENERATED ALWAYS AS IDENTITY (START WITH 100001) PRIMARY KEY,
 document_key text NOT NULL UNIQUE,
 owner_uid text, title text NOT NULL, original_name text, original_sha256 text,
 page_count integer, part_count integer, original_size integer,
 original_ready boolean NOT NULL DEFAULT false,
 gpt_summary text, gpt_basis text, gpt_version integer NOT NULL DEFAULT 0,
 CHECK (part_count IS NULL OR part_count>1 AND page_count>0 AND original_sha256 ~ '^[0-9a-f]{64}$'),
 CHECK (original_size IS NULL OR original_size BETWEEN 1 AND 100000000)
);
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SEQUENCE public.knowledge_documents_id_seq FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.knowledge_documents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.knowledge_documents TO service_role;
GRANT USAGE,SELECT ON public.knowledge_documents_id_seq TO service_role;
CREATE POLICY knowledge_documents_service ON public.knowledge_documents TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.knowledge_document_chunks (
 document_id bigint NOT NULL REFERENCES public.knowledge_documents(id),
 part integer NOT NULL CHECK(part>=0), data text NOT NULL CHECK(length(data) BETWEEN 4 AND 524288),
 PRIMARY KEY(document_id,part)
);
ALTER TABLE public.knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_document_chunks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.knowledge_document_chunks TO service_role;
CREATE POLICY knowledge_document_chunks_service ON public.knowledge_document_chunks TO service_role USING(true) WITH CHECK(true);

-- A stable descriptor travels with the existing row to every consumer, including paged reads.
-- Ignore caller-written document numbers; identity is allocated in the registry.
CREATE FUNCTION public.crm_knowledge_document_stamp_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE doc public.knowledge_documents%ROWTYPE; label text; k text; info jsonb; part jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.metadata ? 'document' THEN
   NEW.metadata:=coalesce(NEW.metadata,'{}')||jsonb_build_object('document',OLD.metadata->'document');
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='knowledge_sources' THEN
   part:=NEW.metadata->'volume';
   IF part IS NOT NULL THEN
     SELECT * INTO STRICT doc FROM public.knowledge_documents WHERE id=(part->>'documentId')::bigint AND owner_uid=NEW.created_by;
     IF doc.part_count IS NULL OR (part->>'index') IS NULL OR (part->>'index')::int NOT BETWEEN 1 AND doc.part_count OR
       (part->>'start')::int IS DISTINCT FROM (1+30*((part->>'index')::int-1)) OR
       (part->>'end')::int IS DISTINCT FROM least(doc.page_count,30*(part->>'index')::int) THEN RAISE EXCEPTION 'Invalid document volume'; END IF;
     info:=jsonb_build_object('number',doc.id,'part',(part->>'index')::int,'total',doc.part_count,
       'start',(part->>'start')::int,'end',(part->>'end')::int,'pages',doc.page_count,'title',doc.title);
   ELSE k:='S-'||NEW.id; label:=NEW.title; END IF;
 ELSIF TG_TABLE_NAME='knowledge_items' THEN
   IF NEW.source_id IS NOT NULL THEN SELECT metadata->'document' INTO info FROM public.knowledge_sources WHERE id=NEW.source_id; END IF;
   IF info IS NULL AND NEW.supersedes_id IS NOT NULL THEN SELECT metadata->'document' INTO info FROM public.knowledge_items WHERE id=NEW.supersedes_id; END IF;
   k:='K-'||NEW.id;label:=NEW.source;
 ELSE
   IF NEW.supersedes_id IS NOT NULL THEN SELECT metadata->'document' INTO info FROM public.playbooks WHERE id=NEW.supersedes_id; END IF;
   k:='P-'||NEW.id;label:=NEW.scenario;
 END IF;
 IF info IS NULL THEN
   INSERT INTO public.knowledge_documents(document_key,owner_uid,title) VALUES(k,NEW.created_by,coalesce(label,k))
     ON CONFLICT(document_key) DO UPDATE SET document_key=excluded.document_key RETURNING * INTO doc;
   info:=jsonb_build_object('number',doc.id);
 END IF;
 NEW.metadata:=(coalesce(NEW.metadata,'{}')-'volume')||jsonb_build_object('document',info);
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_knowledge_document_stamp_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_document_stamp_v1() TO service_role;
CREATE TRIGGER knowledge_document_stamp BEFORE INSERT OR UPDATE OF metadata ON public.knowledge_sources FOR EACH ROW EXECUTE FUNCTION public.crm_knowledge_document_stamp_v1();
CREATE TRIGGER knowledge_document_stamp BEFORE INSERT OR UPDATE OF metadata ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION public.crm_knowledge_document_stamp_v1();
CREATE TRIGGER knowledge_document_stamp BEFORE INSERT OR UPDATE OF metadata ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.crm_knowledge_document_stamp_v1();

-- Match only this previously reconciled set. Local/test databases may contain none of it.
DO $backfill$
DECLARE n integer; owner_name text; book bigint; original_hash constant text:='7ced3383fd388211fa6b7ef60d2d02d20d6d5ee13e7a2bbb24f8ffd25c2dcca4';
BEGIN
 SELECT count(*),min(created_by) INTO n,owner_name FROM public.knowledge_sources
 WHERE (id,sha256) IN ((35,'a88ddaf9e0350950b78df66b72f221fcde83169bdb5ce711da1aa6bb76e5a24d'),
 (36,'2d70c39b32a07fde57e31c5cc3a278c8359b5f0138962d2fb969107d5a692f3c'),(37,'e5add151344acba7f8d984e189f8c9c935deda9e5793d72192c33f000ebcafb1'));
 IF n NOT IN (0,3) THEN RAISE EXCEPTION 'Incomplete legacy document match'; END IF;
 IF n=3 THEN
  INSERT INTO public.knowledge_documents(document_key,owner_uid,title,original_name,original_sha256,page_count,part_count,original_size)
    VALUES(owner_name||':'||original_hash,owner_name,'0917C7资产传承＋婚姻风险','0917C7资产传承＋婚姻风险.pdf',original_hash,85,3,6095867) RETURNING id INTO book;
  UPDATE public.knowledge_sources SET metadata=metadata||jsonb_build_object('volume',jsonb_build_object('documentId',book,'index',id-34,
    'start',1+(id-35)*30,'end',least(85,(id-34)*30))) WHERE id IN(35,36,37);
 END IF;
END $backfill$;
UPDATE public.knowledge_sources SET metadata=metadata WHERE NOT (coalesce(metadata,'{}')?'document');
UPDATE public.knowledge_items SET metadata=metadata WHERE NOT (coalesce(metadata,'{}')?'document');
UPDATE public.playbooks SET metadata=metadata WHERE NOT (coalesce(metadata,'{}')?'document');
CREATE UNIQUE INDEX knowledge_active_volume_slot ON public.knowledge_sources ((metadata#>>'{document,number}'),(metadata#>>'{document,part}'))
 WHERE deleted_at IS NULL AND metadata#>>'{document,part}' IS NOT NULL;
CREATE FUNCTION public.crm_knowledge_document_read_v1(p_document bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH eligible AS (
  SELECT i.id,i.source_id,s.metadata->'document' AS info,i.metadata->>'summary' AS summary,i.content,
   md5(concat_ws('|',i.updated_at,s.updated_at,i.content,i.metadata->>'summary',i.content_state::text)) AS revision,
   row_number() OVER(PARTITION BY s.id ORDER BY i.version_no DESC,i.updated_at DESC,i.id DESC) AS rank
  FROM public.knowledge_sources s JOIN public.knowledge_items i ON i.source_id=s.id
  WHERE s.metadata#>>'{document,number}'=p_document::text AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    AND i.verified AND i.lifecycle_status='verified' AND s.lifecycle_status='verified'
    AND coalesce(s.review_at,current_date)>=current_date AND coalesce(s.valid_from,current_date)<=current_date
    AND coalesce(s.valid_to,current_date)>=current_date AND coalesce(i.valid_from,current_date)<=current_date
    AND coalesce(i.valid_to,current_date)>=current_date AND NOT coalesce((i.content_state->>'paused')::boolean,false)
    AND nullif(btrim(i.metadata->>'summary'),'') IS NOT NULL AND nullif(btrim(i.content),'') IS NOT NULL
    AND (NOT (i.content_state?'original') OR (coalesce((i.content_state#>>'{original,reviewed}')::boolean,false)
     AND i.content_state->>'sourceFingerprint'=concat(s.sha256,':',s.version_no)
     AND i.content_state->>'baseSignature'=md5(i.content||chr(31)||(i.metadata->>'summary'))))
 ), coverage AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',id,'sourceId',source_id,'part',info->'part','start',info->'start','end',info->'end',
    'summary',summary) ORDER BY (info->>'part')::int,id),'[]') AS parts,
    md5(coalesce(string_agg(id::text||':'||revision,',' ORDER BY (info->>'part')::int,id),'')) AS basis
  FROM eligible WHERE rank=1
 )
 SELECT jsonb_build_object('id',d.id,'title',d.title,'name',d.original_name,'parts',c.parts,'total',d.part_count,'pages',d.page_count,
  'originalReady',d.original_ready,'gptVersion',d.gpt_version,'basis',c.basis,'gpt',CASE WHEN d.gpt_basis=c.basis AND c.parts<>'[]'::jsonb THEN d.gpt_summary END,
  'needsReview',d.gpt_summary IS NOT NULL AND d.gpt_basis IS DISTINCT FROM c.basis)
 FROM public.knowledge_documents d CROSS JOIN coverage c WHERE d.id=p_document AND d.part_count IS NOT NULL
$fn$;
REVOKE ALL ON FUNCTION public.crm_knowledge_document_read_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_document_read_v1(bigint) TO service_role;
COMMIT;
