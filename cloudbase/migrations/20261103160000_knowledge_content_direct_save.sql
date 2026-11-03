BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.crm_knowledge_content_v1(p_operation text,p_actor_uid text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' AS $f$
DECLARE c public.knowledge_content_commands%ROWTYPE; old jsonb; nxt jsonb; pair jsonb; patch jsonb; k text; dest text;
 tbl text; rid bigint; current_at timestamptz; cmd uuid; st jsonb; selected text; changed boolean; is_complete boolean;
 meta jsonb; base_text text; saved_source_fingerprint text;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid))=0 OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'CONTENT_ACCESS_DENIED';
 END IF;

 -- Internal worker lease only; no candidate or progress read API is exposed to users.
 IF p_operation='claim' THEN
  SELECT * INTO c FROM public.knowledge_content_commands
   WHERE status='queued' OR (status='running' AND lease_until<clock_timestamp())
   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL); END IF;
  UPDATE public.knowledge_content_commands SET status='running',lease_token=gen_random_uuid(),
   lease_until=clock_timestamp()+interval '5 minutes' WHERE id=c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok',true,'job',to_jsonb(c));
 END IF;
 IF p_operation='progress' THEN
  SELECT * INTO c FROM public.knowledge_content_commands
   WHERE id=(p_data->>'commandId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND OR c.status<>'running' OR c.lease_token IS DISTINCT FROM (p_data->>'leaseToken')::uuid THEN
   RAISE EXCEPTION 'CONTENT_STALE_JOB';
  END IF;
  IF p_data->>'status' NOT IN ('queued','done','failed') OR jsonb_typeof(p_data->'payload')<>'object' THEN
   RAISE EXCEPTION 'CONTENT_INVALID_INPUT';
  END IF;
  UPDATE public.knowledge_content_commands SET status=p_data->>'status',payload=p_data->'payload',lease_until=NULL,
   lease_token=NULL,error_code=left(p_data->>'errorCode',80) WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'commandId',c.id);
 END IF;
 IF p_operation NOT IN ('get','save','regenerate') THEN RAISE EXCEPTION 'CONTENT_OPERATION_REMOVED'; END IF;

 tbl=p_data->>'table'; rid=(p_data->>'id')::bigint;
 IF tbl IS NULL OR tbl NOT IN ('knowledge_items','playbooks') OR rid IS NULL OR rid<=0 THEN
  RAISE EXCEPTION 'CONTENT_INVALID_INPUT';
 END IF;
 IF p_operation='get' THEN
  old=public.crm_knowledge_content_snapshot_v1(tbl,rid);
  RETURN jsonb_build_object('ok',true,'record',old);
 END IF;

 EXECUTE format('SELECT updated_at FROM public.%I WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',tbl)
  INTO current_at USING rid;
 IF current_at IS NULL THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND'; END IF;
 IF p_data->>'expectedUpdatedAt' IS NULL OR current_at<>(p_data->>'expectedUpdatedAt')::timestamptz THEN
  RAISE EXCEPTION 'CONTENT_STALE';
 END IF;
 old=public.crm_knowledge_content_snapshot_v1(tbl,rid);
 IF p_data->>'expectedVersion' IS NULL OR (old->>'version')::int<>(p_data->>'expectedVersion')::int OR
    NOT (p_data ? 'expectedSourceFingerprint') OR old->>'sourceFingerprint' IS DISTINCT FROM p_data->>'expectedSourceFingerprint' THEN
  RAISE EXCEPTION 'CONTENT_STALE';
 END IF;

 IF p_operation='regenerate' THEN
  IF coalesce(p_data->>'part','') NOT IN ('text','summary','both') THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
  IF p_data->>'part'<>'summary' AND old->>'inputMode'<>'attachment' THEN RAISE EXCEPTION 'CONTENT_ORIGINAL_REQUIRED'; END IF;
  IF p_data->>'part'='summary' AND nullif(btrim(old#>>'{original,text}'),'') IS NULL THEN RAISE EXCEPTION 'CONTENT_ORIGINAL_REQUIRED'; END IF;
  SELECT id INTO cmd FROM public.knowledge_content_commands
   WHERE record_table=tbl AND record_id=rid AND actor_uid=p_actor_uid AND operation='regenerate'
    AND expected_updated_at=current_at AND payload->>'part'=p_data->>'part' AND status IN ('queued','running')
   LIMIT 1;
  IF cmd IS NULL THEN
   INSERT INTO public.knowledge_content_commands(actor_uid,record_table,record_id,expected_updated_at,operation,status,before_state,payload)
   VALUES(p_actor_uid,tbl,rid,current_at,'regenerate','queued',old,jsonb_build_object(
    'part',p_data->>'part','stage',CASE WHEN p_data->>'part'='summary' THEN 'summary' ELSE 'extract' END,
    'text',CASE WHEN p_data->>'part'='summary' THEN old#>>'{original,text}' ELSE NULL END,'nextPage',1))
   RETURNING id INTO cmd;
  END IF;
  RETURN jsonb_build_object('ok',true,'commandId',cmd,'status','queued');
 END IF;

 -- Direct save: exact record, timestamp, content version, and linked-source fingerprint.
 dest=p_data->>'target'; patch=p_data->'patch';
 IF dest NOT IN ('original','gpt') OR jsonb_typeof(patch) IS DISTINCT FROM 'object' OR patch='{}'::jsonb OR
    NOT (p_data ? 'expectedSourceFingerprint') THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 pair=old->dest;
 FOR k IN SELECT jsonb_object_keys(patch) LOOP
  IF k NOT IN ('text','summary') OR (dest='gpt' AND k<>'summary') OR jsonb_typeof(patch->k) NOT IN ('string','null') OR
     length(coalesce(patch->>k,''))>(CASE WHEN k='text' THEN 120000 ELSE 12000 END) THEN
   RAISE EXCEPTION 'CONTENT_INVALID_INPUT';
  END IF;
  pair=jsonb_set(pair,ARRAY[k],coalesce(to_jsonb(nullif(btrim(patch->>k),'')),'null'::jsonb));
 END LOOP;
 IF tbl='knowledge_items' THEN
  SELECT content,coalesce(metadata,'{}'::jsonb),content_state->>'sourceFingerprint'
   INTO base_text,meta,saved_source_fingerprint FROM public.knowledge_items WHERE id=rid;
 ELSE
  SELECT response_logic,coalesce(metadata,'{}'::jsonb),content_state->>'sourceFingerprint'
   INTO base_text,meta,saved_source_fingerprint FROM public.playbooks WHERE id=rid;
 END IF;
 IF dest='original' AND old->>'inputMode'='attachment' AND saved_source_fingerprint IS DISTINCT FROM old->>'sourceFingerprint'
    AND nullif(btrim(pair->>'text'),'') IS NOT NULL AND nullif(btrim(pair->>'summary'),'') IS NOT NULL
    AND coalesce((p_data->>'sourceValidated')::boolean,false)=false THEN RAISE EXCEPTION 'CONTENT_SOURCE_STALE'; END IF;

 changed=pair IS DISTINCT FROM old->dest;
 pair=jsonb_set(pair,'{reviewed}','true');
 IF dest='gpt' AND nullif(btrim(pair->>'summary'),'') IS NULL THEN
  pair=jsonb_set(pair,'{manualCleared}',coalesce(pair->'manualCleared','[]'::jsonb)||to_jsonb('summary'::text));
 END IF;
 nxt=jsonb_set(old,ARRAY[dest],pair);
 IF dest='original' THEN
  -- Base columns are NOT NULL legacy storage. Keep their last non-empty value when the managed field is cleared.
  base_text=coalesce(nxt#>>'{original,text}',base_text);
  nxt=jsonb_set(nxt,'{baseSignature}',to_jsonb(md5(coalesce(base_text,'')||chr(31)||coalesce(pair->>'summary',''))));
  IF changed AND old->>'inputMode'='recorded_text' THEN nxt=jsonb_set(nxt,'{gpt,reviewed}','false'); END IF;
 ELSIF changed THEN
  nxt=jsonb_set(nxt,'{gpt,provenance}','"manual_chatgpt_edited"');
 END IF;
 selected=coalesce(nxt->>'selected','original');
 IF selected<>'original' THEN RAISE EXCEPTION 'CONTENT_INVALID_INPUT'; END IF;
 pair=nxt->selected;
 is_complete=nullif(btrim(pair->>'text'),'') IS NOT NULL AND nullif(btrim(pair->>'summary'),'') IS NOT NULL AND
  coalesce((pair->>'reviewed')::boolean,false);
 nxt=jsonb_set(nxt,'{paused}',to_jsonb(NOT is_complete));
 st=(nxt-'table'-'id'-'title'-'updatedAt'-'source'-'lifecycleStatus'-'inputMode'-'managed')#-'{gpt,text}';
 st=st#-'{gpt,summary}';
 st=jsonb_set(st,'{version}',to_jsonb((old->>'version')::int+1));
 IF nullif(btrim(nxt#>>'{original,summary}'),'') IS NULL THEN meta=meta-'summary';
 ELSE meta=jsonb_set(meta,'{summary}',to_jsonb(nxt#>>'{original,summary}'),true); END IF;
 IF tbl='knowledge_items' THEN
  UPDATE public.knowledge_items SET content=base_text,metadata=meta,gpt_summary=nxt#>>'{gpt,summary}',
   selected_content_source=nxt->>'selected',content_state=st,updated_at=clock_timestamp(),updated_by=p_actor_uid WHERE id=rid;
 ELSE
  UPDATE public.playbooks SET response_logic=base_text,metadata=meta,gpt_summary=nxt#>>'{gpt,summary}',
   selected_content_source=nxt->>'selected',content_state=st,updated_at=clock_timestamp(),updated_by=p_actor_uid WHERE id=rid;
 END IF;
 RETURN jsonb_build_object('ok',true,'record',public.crm_knowledge_content_snapshot_v1(tbl,rid));
END; $f$;
REVOKE ALL ON FUNCTION public.crm_knowledge_content_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_knowledge_content_v1(text,text,jsonb) TO service_role;
COMMIT;
