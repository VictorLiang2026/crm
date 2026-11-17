BEGIN;
SET LOCAL lock_timeout='5s';
-- One private append-only history for both existing record types; no new content catalog.
CREATE TABLE public.knowledge_record_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 record_table text NOT NULL CHECK(record_table IN ('knowledge_items','playbooks')),
 record_id bigint NOT NULL, snapshot jsonb NOT NULL,
 actor_uid text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX knowledge_record_history_lookup ON public.knowledge_record_history(record_table,record_id,id DESC);
ALTER TABLE public.knowledge_record_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_record_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_record_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.knowledge_record_history TO service_role;
REVOKE ALL ON SEQUENCE public.knowledge_record_history_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE,SELECT ON SEQUENCE public.knowledge_record_history_id_seq TO service_role;
CREATE POLICY knowledge_history_service ON public.knowledge_record_history TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_knowledge_history_stamp_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE before_row jsonb; after_row jsonb; fp text;
BEGIN
 IF NEW.metadata ? 'enabled' AND jsonb_typeof(NEW.metadata->'enabled') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'KNOWLEDGE_INVALID_ENABLED';
 END IF;
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 after_row=to_jsonb(NEW);
 IF TG_TABLE_NAME='knowledge_items' AND after_row->>'source_id' IS NOT NULL THEN
  SELECT coalesce(sha256,'')||':'||version_no::text INTO fp FROM public.knowledge_sources WHERE id=(after_row->>'source_id')::bigint;
  after_row=after_row||jsonb_build_object('_sourceFingerprint',coalesce(after_row#>>'{content_state,sourceFingerprint}',fp));
 END IF;
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT 1 FROM public.knowledge_record_history WHERE record_table=TG_TABLE_NAME AND record_id=NEW.id) THEN
  before_row=to_jsonb(OLD);
  IF TG_TABLE_NAME='knowledge_items' AND before_row->>'source_id' IS NOT NULL THEN
   SELECT coalesce(sha256,'')||':'||version_no::text INTO fp FROM public.knowledge_sources WHERE id=(before_row->>'source_id')::bigint;
   before_row=before_row||jsonb_build_object('_sourceFingerprint',coalesce(before_row#>>'{content_state,sourceFingerprint}',fp));
  END IF;
  INSERT INTO public.knowledge_record_history(record_table,record_id,snapshot,actor_uid)
   VALUES(TG_TABLE_NAME,OLD.id,before_row,OLD.updated_by);
 END IF;
 INSERT INTO public.knowledge_record_history(record_table,record_id,snapshot,actor_uid)
  VALUES(TG_TABLE_NAME,NEW.id,after_row,NEW.updated_by);
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_history_stamp_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_history_stamp_v1() TO service_role;
CREATE TRIGGER knowledge_history AFTER INSERT OR UPDATE ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION public.crm_knowledge_history_stamp_v1();
CREATE TRIGGER knowledge_history AFTER INSERT OR UPDATE ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.crm_knowledge_history_stamp_v1();

CREATE FUNCTION public.crm_knowledge_maintain_v1(p_operation text,p_actor_uid text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE tbl text; rid bigint; old jsonb; historical jsonb; rows jsonb; meta jsonb; payload jsonb; current_source jsonb;
 offset_n int; lim int; saved jsonb; title_text text; body_text text; kind text;
BEGIN
 IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'KNOWLEDGE_ACCESS_DENIED'; END IF;
 IF p_operation='list' THEN
  offset_n=coalesce((p_data->>'offset')::int,0);lim=coalesce((p_data->>'limit')::int,100);
  IF offset_n<0 OR lim<1 OR lim>200 THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO rows FROM
   (SELECT * FROM public.playbooks WHERE deleted_at IS NULL AND metadata->>'usage'='communication_reference' ORDER BY id LIMIT lim+1 OFFSET offset_n) t;
  RETURN jsonb_build_object('ok',true,'rows',rows,'hasMore',jsonb_array_length(rows)>lim,'nextOffset',offset_n+lim);
 END IF;
 tbl=p_data->>'table';rid=(p_data->>'id')::bigint;
 IF tbl IS NULL OR tbl NOT IN ('knowledge_items','playbooks') THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
 IF p_operation='history' THEN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND deleted_at IS NULL',tbl) INTO old USING rid;
  IF old IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id DESC),'[]') INTO rows FROM
   (SELECT id,snapshot,actor_uid,created_at FROM public.knowledge_record_history WHERE record_table=tbl AND record_id=rid ORDER BY id DESC LIMIT 100) t;
  RETURN jsonb_build_object('ok',true,'rows',rows);
 END IF;
 IF p_operation NOT IN ('saveReference','toggle','restore') THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
 IF rid IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',tbl) INTO old USING rid;
  IF old IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND'; END IF;
  IF p_data->>'expectedUpdatedAt' IS NULL OR (old->>'updated_at')::timestamptz<>(p_data->>'expectedUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'KNOWLEDGE_STALE'; END IF;
 END IF;
 IF p_operation='toggle' THEN
  IF old IS NULL OR jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
  meta=jsonb_set(coalesce(old->'metadata','{}'),'{enabled}',p_data->'enabled');
  EXECUTE format('UPDATE public.%I SET metadata=$1,updated_by=$2,updated_at=clock_timestamp() WHERE id=$3 RETURNING to_jsonb(%I)',tbl,tbl) INTO saved USING meta,p_actor_uid,rid;
 ELSIF p_operation='saveReference' THEN
  IF tbl<>'playbooks' OR (old IS NOT NULL AND old#>>'{metadata,usage}' IS DISTINCT FROM 'communication_reference') THEN RAISE EXCEPTION 'KNOWLEDGE_REFERENCE_REQUIRED'; END IF;
  title_text=btrim(p_data->>'title');body_text=btrim(p_data->>'content');kind=p_data->>'kind';
  IF title_text IS NULL OR length(title_text) NOT BETWEEN 1 AND 160 OR body_text IS NULL OR length(body_text) NOT BETWEEN 1 AND 4000 OR kind IS NULL OR kind NOT IN ('wording','objection') OR
   jsonb_typeof(p_data->'keywords') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'keywords')>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'keywords') k WHERE jsonb_typeof(k)<>'string' OR length(k#>>'{}') NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
  meta=coalesce(old->'metadata','{}')||jsonb_build_object('usage','communication_reference','kind',kind,'keywords',p_data->'keywords',
   'enabled',coalesce(old#>'{metadata,enabled}','true'::jsonb),'summary',left(body_text,180),'categories',jsonb_build_array(CASE WHEN kind='objection' THEN 'objection_handling' ELSE 'conversation_strategy' END),'domain','playbook');
  -- Source descriptors are copied from the bundled/manual source by the authenticated human editor.
  IF old IS NULL THEN meta=meta||jsonb_build_object('origin',left(coalesce(p_data->>'origin',''),1000),'entryKey',left(coalesce(p_data->>'entryKey',''),160)); END IF;
  IF rid IS NULL THEN
   IF nullif(meta->>'entryKey','') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(meta->>'entryKey',0));
    SELECT to_jsonb(p) INTO saved FROM public.playbooks p WHERE metadata->>'entryKey'=meta->>'entryKey' LIMIT 1;
    IF saved IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'skipped',true,'row',saved); END IF;
   END IF;
   INSERT INTO public.playbooks(scenario,objection,response_logic,next_objective,source,confidence,lifecycle_status,metadata,created_by,updated_by,verified_by)
    VALUES(title_text,title_text,body_text,'Follow the established strategy; wording reference only','Communication reference',0.8,'verified',meta,p_actor_uid,p_actor_uid,p_actor_uid) RETURNING to_jsonb(playbooks) INTO saved;
  ELSE
   UPDATE public.playbooks SET scenario=title_text,objection=title_text,response_logic=body_text,metadata=meta,version_no=version_no+1,
    content_state='{}'::jsonb,gpt_summary=NULL,selected_content_source='original',updated_by=p_actor_uid,updated_at=clock_timestamp()
    WHERE id=rid RETURNING to_jsonb(playbooks) INTO saved;
  END IF;
 ELSE
  IF old IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_INVALID_INPUT'; END IF;
  SELECT snapshot INTO historical FROM public.knowledge_record_history WHERE id=(p_data->>'historyId')::bigint AND record_table=tbl AND record_id=rid;
  IF historical IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_HISTORY_NOT_FOUND'; END IF;
  IF old->>'source_id' IS NOT NULL THEN
   SELECT jsonb_build_object('fingerprint',coalesce(sha256,'')||':'||version_no::text) INTO current_source FROM public.knowledge_sources WHERE id=(old->>'source_id')::bigint AND deleted_at IS NULL;
   IF current_source IS NULL OR historical->>'_sourceFingerprint' IS DISTINCT FROM current_source->>'fingerprint' THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED'; END IF;
  END IF;
  -- Restore content only. Never restore enabled state, source ownership, lifecycle, deletion or document identity.
  meta=(old->'metadata')||jsonb_build_object('summary',coalesce(historical#>'{metadata,summary}','""'::jsonb));
  IF tbl='playbooks' AND old#>>'{metadata,usage}'='communication_reference' THEN
   meta=meta||jsonb_build_object('kind',historical#>'{metadata,kind}','keywords',historical#>'{metadata,keywords}');
   UPDATE public.playbooks SET scenario=historical->>'scenario',objection=historical->>'objection',response_logic=historical->>'response_logic',metadata=meta,
    content_state='{}',gpt_summary=NULL,selected_content_source='original',version_no=version_no+1,updated_by=p_actor_uid,updated_at=clock_timestamp()
    WHERE id=rid RETURNING to_jsonb(playbooks) INTO saved;
  ELSE
   payload=coalesce(historical->'content_state','{}');
   payload=jsonb_set(payload,'{version}',to_jsonb(coalesce((old#>>'{content_state,version}')::int,0)+1));
   payload=jsonb_set(payload,'{gpt}',coalesce(payload->'gpt','{}')||'{"reviewed":false}'::jsonb);
   EXECUTE format('UPDATE public.%I SET %I=$1,metadata=$2,content_state=$3,gpt_summary=$4,version_no=version_no+1,updated_by=$5,updated_at=clock_timestamp() WHERE id=$6 RETURNING to_jsonb(%I)',
    tbl,CASE WHEN tbl='knowledge_items' THEN 'content' ELSE 'response_logic' END,tbl)
    INTO saved USING historical->>CASE WHEN tbl='knowledge_items' THEN 'content' ELSE 'response_logic' END,meta,payload,historical->>'gpt_summary',p_actor_uid,rid;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'row',saved);
END $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_maintain_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_maintain_v1(text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.crm_knowledge_document_read_v1(p_document bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH eligible AS (
  SELECT i.id,i.source_id,s.metadata->'document' AS info,i.metadata->>'summary' AS summary,i.content,
   md5(concat_ws('|',i.updated_at,s.updated_at,i.content,i.metadata->>'summary',i.content_state::text)) AS revision,
   row_number() OVER(PARTITION BY s.id ORDER BY i.version_no DESC,i.updated_at DESC,i.id DESC) AS rank
  FROM public.knowledge_sources s JOIN public.knowledge_items i ON i.source_id=s.id
  WHERE s.metadata#>>'{document,number}'=p_document::text AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    AND coalesce(i.metadata->>'enabled','true')='true' AND i.verified AND i.lifecycle_status='verified' AND s.lifecycle_status='verified'
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

COMMIT;
