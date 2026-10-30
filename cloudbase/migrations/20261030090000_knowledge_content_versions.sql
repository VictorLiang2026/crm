BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.knowledge_items ADD COLUMN gpt_original_text text, ADD COLUMN gpt_summary text,
 ADD COLUMN selected_content_source text NOT NULL DEFAULT 'original' CHECK(selected_content_source IN ('original','gpt')),
 ADD COLUMN content_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(content_state)='object');
ALTER TABLE public.playbooks ADD COLUMN gpt_original_text text, ADD COLUMN gpt_summary text,
 ADD COLUMN selected_content_source text NOT NULL DEFAULT 'original' CHECK(selected_content_source IN ('original','gpt')),
 ADD COLUMN content_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(content_state)='object');

CREATE TABLE public.knowledge_content_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_uid text NOT NULL CHECK(length(actor_uid)>0),
 record_table text NOT NULL CHECK(record_table IN ('knowledge_items','playbooks')), record_id bigint NOT NULL CHECK(record_id>0),
 expected_updated_at timestamptz NOT NULL, operation text NOT NULL,
 status text NOT NULL CHECK(status IN ('preview','applied','queued','running','done','failed')),
 before_state jsonb NOT NULL, after_state jsonb, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz,
 applied_at timestamptz, lease_until timestamptz, lease_token uuid, error_code text
);
CREATE INDEX knowledge_content_commands_record_idx ON public.knowledge_content_commands(record_table,record_id,created_at DESC);
CREATE INDEX knowledge_content_commands_queue_idx ON public.knowledge_content_commands(created_at) WHERE status IN ('queued','running');
ALTER TABLE public.knowledge_content_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_content_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_content_commands_service_only ON public.knowledge_content_commands FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.knowledge_content_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.knowledge_content_commands TO service_role;

CREATE FUNCTION public.crm_knowledge_content_snapshot_v1(p_table text,p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE r jsonb; s jsonb; st jsonb; o jsonb; g jsonb; sig text; fp text; title text; managed boolean;
BEGIN
 IF current_user<>'service_role' OR p_table IS NULL OR p_table NOT IN ('knowledge_items','playbooks') OR p_id IS NULL OR p_id<=0 THEN RAISE EXCEPTION 'CONTENT_ACCESS_DENIED'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND deleted_at IS NULL',p_table) INTO r USING p_id;
 IF r IS NULL OR r->>'lifecycle_status'='superseded' THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
 IF p_table='knowledge_items' AND r->>'source_id' IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'sha256',sha256,'version_no',version_no,'lifecycle_status',lifecycle_status,'deleted_at',deleted_at,'review_at',review_at,'valid_from',valid_from,'valid_to',valid_to)
  INTO s FROM public.knowledge_sources WHERE id=(r->>'source_id')::bigint;
 END IF;
 o=jsonb_build_object('text',CASE WHEN p_table='playbooks' THEN r->>'response_logic' ELSE r->>'content' END,
  'summary',CASE WHEN p_table='playbooks' THEN coalesce(r#>>'{metadata,summary}',r->>'response_logic') ELSE r#>>'{metadata,summary}' END,'reviewed',true);
 sig=md5(coalesce(o->>'text','')||chr(31)||coalesce(o->>'summary',''));
 fp=CASE WHEN s IS NOT NULL THEN coalesce(s->>'sha256','')||':'||coalesce(s->>'version_no','') ELSE NULL END;
 st=coalesce(r->'content_state','{}'); managed=st ? 'original';
 IF managed AND st->>'baseSignature'=sig THEN o=st->'original'; END IF;
 g=jsonb_build_object('text',r->>'gpt_original_text','summary',r->>'gpt_summary','reviewed',coalesce((st#>>'{gpt,reviewed}')::boolean,false),
  'manualCleared',coalesce(st#>'{gpt,manualCleared}','[]'::jsonb),'provenance',coalesce(st#>>'{gpt,provenance}','manual_chatgpt'));
 IF managed AND ((s IS NOT NULL AND st->>'sourceFingerprint' IS DISTINCT FROM fp) OR
   (s IS NULL AND st->>'baseSignature' IS DISTINCT FROM sig)) THEN
   g=jsonb_set(g,'{reviewed}','false');
   IF s IS NOT NULL THEN o=jsonb_set(o,'{reviewed}','false'); END IF;
 END IF;
 title=CASE WHEN p_table='playbooks' THEN r->>'scenario' ELSE r->>'source' END;
 RETURN jsonb_build_object('table',p_table,'id',p_id,'title',title,'updatedAt',r->>'updated_at','original',o,'gpt',g,
  'selected',r->>'selected_content_source','paused',coalesce((st->>'paused')::boolean,false),'managed',managed,
  'baseSignature',sig,'sourceFingerprint',fp,'source',s,'lifecycleStatus',r->>'lifecycle_status',
  'version',coalesce((st->>'version')::int,0),'inputMode',CASE WHEN s IS NULL THEN 'recorded_text' ELSE 'attachment' END);
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_content_snapshot_v1(text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_content_snapshot_v1(text,bigint) TO service_role;

CREATE FUNCTION public.crm_knowledge_content_v1(p_operation text,p_actor_uid text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' AS $f$
DECLARE c public.knowledge_content_commands%ROWTYPE; old jsonb; nxt jsonb; pair jsonb; patch jsonb; k text; dest text;
 tbl text; rid bigint; current_at timestamptz; cmd uuid; st jsonb; hist jsonb; selected text; changed boolean; is_complete boolean;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid))=0 OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CONTENT_ACCESS_DENIED'; END IF;
 IF p_operation='claim' THEN
  SELECT * INTO c FROM public.knowledge_content_commands WHERE status='queued' OR (status='running' AND lease_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL); END IF;
  UPDATE public.knowledge_content_commands SET status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes' WHERE id=c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok',true,'job',to_jsonb(c));
 END IF;
 IF p_operation='progress' THEN
  SELECT * INTO c FROM public.knowledge_content_commands WHERE id=(p_data->>'commandId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND OR c.status<>'running' OR c.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid THEN RAISE EXCEPTION 'CONTENT_STALE_JOB'; END IF;
  IF p_data->>'status' NOT IN ('queued','done','failed') OR jsonb_typeof(p_data->'payload')<>'object' THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
  UPDATE public.knowledge_content_commands SET status=p_data->>'status',payload=p_data->'payload',lease_until=NULL,lease_token=NULL,error_code=left(p_data->>'errorCode',80) WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'commandId',c.id);
 END IF;
 IF p_operation IN ('apply','command','retry') THEN
  SELECT * INTO c FROM public.knowledge_content_commands WHERE id=(p_data->>'commandId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
  IF p_operation='command' THEN RETURN jsonb_build_object('ok',true,'commandId',c.id,'status',c.status,'before',c.before_state,'after',c.after_state,
   'progress',c.payload-'text','errorCode',c.error_code,'expiresAt',c.expires_at); END IF;
  IF p_operation='retry' THEN
   IF c.operation<>'regenerate' OR c.status NOT IN ('failed','done') THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
   old=public.crm_knowledge_content_snapshot_v1(c.record_table,c.record_id);
   IF old<>c.before_state THEN RAISE EXCEPTION 'CONTENT_STALE'; END IF;
   UPDATE public.knowledge_content_commands SET status='queued',error_code=NULL,lease_until=NULL,lease_token=NULL WHERE id=c.id;
   RETURN jsonb_build_object('ok',true,'commandId',c.id,'status','queued');
  END IF;
  IF c.status='applied' THEN RETURN jsonb_build_object('ok',true,'reused',true,'commandId',c.id); END IF;
  IF c.status<>'preview' OR c.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'CONTENT_PREVIEW_EXPIRED'; END IF;
  tbl=c.record_table;rid=c.record_id;
 ELSE tbl=p_data->>'table';rid=(p_data->>'id')::bigint; END IF;
 IF tbl IS NULL OR tbl NOT IN ('knowledge_items','playbooks') OR rid IS NULL OR rid<=0 THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 EXECUTE format('SELECT updated_at FROM public.%I WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',tbl) INTO current_at USING rid;
 IF current_at IS NULL THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
 old=public.crm_knowledge_content_snapshot_v1(tbl,rid);
 IF p_operation='get' THEN
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO hist FROM (SELECT id,operation,applied_at FROM public.knowledge_content_commands
    WHERE record_table=tbl AND record_id=rid AND status='applied' AND actor_uid=p_actor_uid ORDER BY applied_at DESC LIMIT 20) x;
  RETURN jsonb_build_object('ok',true,'record',old,'history',hist);
 END IF;
 IF p_operation='apply' THEN
  IF current_at<>c.expected_updated_at OR old<>c.before_state THEN RAISE EXCEPTION 'CONTENT_STALE'; END IF;
  nxt=c.after_state;
  st=(nxt-'table'-'id'-'title'-'updatedAt'-'source'-'lifecycleStatus'-'inputMode'-'managed')#-'{gpt,text}'; st=st#-'{gpt,summary}';
  st=jsonb_set(st,'{version}',to_jsonb((old->>'version')::int+1));
  EXECUTE format('UPDATE public.%I SET gpt_original_text=$1,gpt_summary=$2,selected_content_source=$3,content_state=$4,updated_at=clock_timestamp(),updated_by=$5 WHERE id=$6',tbl)
   USING nxt#>>'{gpt,text}',nxt#>>'{gpt,summary}',nxt->>'selected',st,p_actor_uid,rid;
  UPDATE public.knowledge_content_commands SET status='applied',applied_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'commandId',c.id,'record',public.crm_knowledge_content_snapshot_v1(tbl,rid));
 END IF;
 IF p_data->>'expectedUpdatedAt' IS NULL OR current_at<>(p_data->>'expectedUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'CONTENT_STALE'; END IF;
 IF p_operation='regenerate' THEN
  IF coalesce(p_data->>'part','') NOT IN ('text','summary','both') THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
  IF p_data->>'part'<>'summary' AND old->>'inputMode'<>'attachment' THEN RAISE EXCEPTION 'CONTENT_ORIGINAL_REQUIRED'; END IF;
  IF p_data->>'part'='summary' AND nullif(btrim(old#>>'{original,text}'),'') IS NULL THEN RAISE EXCEPTION 'CONTENT_ORIGINAL_REQUIRED'; END IF;
  SELECT id INTO cmd FROM public.knowledge_content_commands WHERE record_table=tbl AND record_id=rid AND actor_uid=p_actor_uid AND operation='regenerate'
   AND expected_updated_at=current_at AND payload->>'part'=p_data->>'part' AND status IN ('queued','running') LIMIT 1;
  IF cmd IS NULL THEN INSERT INTO public.knowledge_content_commands(actor_uid,record_table,record_id,expected_updated_at,operation,status,before_state,payload)
   VALUES(p_actor_uid,tbl,rid,current_at,'regenerate','queued',old,jsonb_build_object('part',p_data->>'part','stage',CASE WHEN p_data->>'part'='summary' THEN 'summary' ELSE 'extract' END,
    'text',CASE WHEN p_data->>'part'='summary' THEN old#>>'{original,text}' ELSE NULL END,'nextPage',1)) RETURNING id INTO cmd; END IF;
  RETURN jsonb_build_object('ok',true,'commandId',cmd,'status','queued');
 END IF;
 IF p_operation IS DISTINCT FROM 'preview' THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 nxt=old;
 IF p_data->>'action'='restore' THEN
  SELECT * INTO c FROM public.knowledge_content_commands WHERE id=(p_data->>'historyId')::uuid AND actor_uid=p_actor_uid AND record_table=tbl AND record_id=rid AND status='applied';
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
  nxt=jsonb_set(jsonb_set(nxt,'{original}',c.before_state->'original'),'{gpt}',c.before_state->'gpt');
  IF c.before_state->>'sourceFingerprint' IS DISTINCT FROM old->>'sourceFingerprint' THEN
   nxt=jsonb_set(jsonb_set(nxt,'{original,reviewed}','false'),'{gpt,reviewed}','false');
  END IF;
 ELSIF p_data->>'action'='edit' THEN
  dest=p_data->>'target';patch=p_data->'patch';
  IF coalesce(dest,'') NOT IN ('original','gpt') OR jsonb_typeof(patch) IS DISTINCT FROM 'object' OR patch='{}'::jsonb THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
  pair=old->dest;
  FOR k IN SELECT jsonb_object_keys(patch) LOOP
   IF k NOT IN ('text','summary') OR (jsonb_typeof(patch->k) NOT IN ('string','null')) OR length(coalesce(patch->>k,''))>(CASE WHEN k='text' THEN 120000 ELSE 12000 END) THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
   IF dest='gpt' AND nullif(btrim(patch->>k),'') IS NOT NULL AND nullif(btrim(pair->>k),'') IS NULL AND
     (nullif(btrim(old#>>'{original,text}'),'') IS NULL OR nullif(btrim(old#>>'{original,summary}'),'') IS NULL) THEN RAISE EXCEPTION 'CONTENT_SYSTEM_PAIR_REQUIRED'; END IF;
   pair=jsonb_set(pair,ARRAY[k],coalesce(to_jsonb(nullif(btrim(patch->>k),'')),'null'::jsonb));
   IF dest='gpt' AND nullif(btrim(patch->>k),'') IS NULL THEN pair=jsonb_set(pair,'{manualCleared}',coalesce(pair->'manualCleared','[]')||to_jsonb(k)); END IF;
  END LOOP;
  changed=pair IS DISTINCT FROM old->dest;
  IF changed THEN pair=jsonb_set(pair,'{reviewed}',to_jsonb(coalesce((p_data->>'reviewed')::boolean,false)));
   IF dest='gpt' THEN pair=jsonb_set(pair,'{provenance}','"manual_chatgpt_edited"'); END IF;
  ELSIF coalesce((p_data->>'reviewed')::boolean,false) THEN pair=jsonb_set(pair,'{reviewed}','true'); END IF;
  nxt=jsonb_set(nxt,ARRAY[dest],pair);
  IF dest='original' AND old->>'inputMode'='recorded_text' AND pair->>'text' IS DISTINCT FROM old#>>'{original,text}' AND nullif(pair->>'text','') IS NOT NULL THEN nxt=jsonb_set(nxt,'{gpt,reviewed}','false'); END IF;
 ELSIF p_data->>'action' IS DISTINCT FROM 'select' THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 selected=coalesce(p_data->>'selected',nxt->>'selected');
 IF selected NOT IN ('original','gpt') THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 pair=nxt->selected;
 is_complete=nullif(btrim(pair->>'text'),'') IS NOT NULL AND nullif(btrim(pair->>'summary'),'') IS NOT NULL AND coalesce((pair->>'reviewed')::boolean,false);
 IF p_data ? 'selected' AND NOT is_complete THEN RAISE EXCEPTION 'CONTENT_PAIR_NOT_READY'; END IF;
 nxt=jsonb_set(jsonb_set(nxt,'{selected}',to_jsonb(selected)),'{paused}',to_jsonb(NOT is_complete));
 INSERT INTO public.knowledge_content_commands(actor_uid,record_table,record_id,expected_updated_at,operation,status,before_state,after_state,expires_at)
 VALUES(p_actor_uid,tbl,rid,current_at,p_data->>'action','preview',old,nxt,clock_timestamp()+interval '15 minutes') RETURNING id INTO cmd;
 RETURN jsonb_build_object('ok',true,'commandId',cmd,'before',old,'after',nxt,'expiresAt',clock_timestamp()+interval '15 minutes');
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_content_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_content_v1(text,text,jsonb) TO service_role;
COMMENT ON TABLE public.knowledge_content_commands IS 'Actor-bound knowledge content previews, applied history and resumable system regeneration; no automatic GPT calls.';
COMMIT;
