BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.crm_reference_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 entry_id bigint NOT NULL REFERENCES public.playbooks(id),
 parent_id bigint REFERENCES public.crm_reference_versions(id),
 source text NOT NULL CHECK(source IN ('original','manual','system','gpt')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 kind text NOT NULL CHECK(kind IN ('wording','objection')),
 keywords jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(keywords)='array'),
 note text NOT NULL DEFAULT '', origin text NOT NULL DEFAULT '',
 confirmed boolean NOT NULL DEFAULT false, actor_uid text NOT NULL,
 model_info jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_reference_versions_entry ON public.crm_reference_versions(entry_id,id DESC);
CREATE TABLE public.crm_reference_state (
 entry_id bigint PRIMARY KEY REFERENCES public.playbooks(id),
 current_id bigint REFERENCES public.crm_reference_versions(id), pinned boolean NOT NULL DEFAULT false,
 want_system boolean NOT NULL DEFAULT false,want_gpt boolean NOT NULL DEFAULT false,
 system_epoch integer NOT NULL DEFAULT 0,gpt_epoch integer NOT NULL DEFAULT 0,
 instruction text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.crm_reference_preferences (
 actor_uid text PRIMARY KEY, body text NOT NULL DEFAULT '' CHECK(length(body)<=3000),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.crm_reference_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL,actor_uid text NOT NULL,
 entry_id bigint REFERENCES public.playbooks(id),lane text NOT NULL CHECK(lane IN ('system','gpt','parse')),
 epoch integer NOT NULL DEFAULT 0,base_id bigint REFERENCES public.crm_reference_versions(id),
 input jsonb NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 lease uuid,lease_at timestamptz,attempts integer NOT NULL DEFAULT 0,
 result_id bigint REFERENCES public.crm_reference_versions(id),output jsonb,last_error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(entry_id,lane,epoch)
);
CREATE INDEX crm_reference_jobs_queue ON public.crm_reference_jobs(lane,status,created_at);
CREATE UNIQUE INDEX crm_reference_parse_document ON public.crm_reference_jobs(actor_uid,(input->>'documentId')) WHERE lane='parse';
CREATE TABLE public.crm_reference_batches (
 id uuid PRIMARY KEY,actor_uid text NOT NULL,lane text NOT NULL CHECK(lane IN ('system','gpt')),
 selected integer NOT NULL DEFAULT 0,job_ids uuid[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.crm_reference_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_uid text NOT NULL,preview_rows jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',result jsonb
);
DO $setup$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['crm_reference_versions','crm_reference_state','crm_reference_preferences','crm_reference_jobs','crm_reference_previews','crm_reference_batches'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY reference_service ON public.%I TO service_role USING(true) WITH CHECK(true)',t);
 END LOOP;
END $setup$;
REVOKE ALL ON SEQUENCE public.crm_reference_versions_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.crm_reference_versions_id_seq TO service_role;

-- Keep old histories intact. Initial current content is an approved baseline.
INSERT INTO public.crm_reference_versions(entry_id,source,title,content,kind,keywords,origin,confirmed,actor_uid)
 SELECT id,'original',scenario,response_logic,coalesce(metadata->>'kind','wording'),coalesce(metadata->'keywords','[]'),coalesce(metadata->>'origin',''),true,coalesce(updated_by,'migration')
 FROM public.playbooks WHERE metadata->>'usage'='communication_reference' AND deleted_at IS NULL;
INSERT INTO public.crm_reference_state(entry_id,current_id) SELECT entry_id,id FROM public.crm_reference_versions;

CREATE FUNCTION public.crm_reference_capture_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE vid bigint; parent bigint;
BEGIN
 IF NEW.metadata->>'usage' IS DISTINCT FROM 'communication_reference' THEN RETURN NEW; END IF;
 IF nullif(current_setting('crm.reference_apply',true),'') IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.scenario IS NOT DISTINCT FROM OLD.scenario AND NEW.response_logic IS NOT DISTINCT FROM OLD.response_logic
  AND NEW.metadata->'kind' IS NOT DISTINCT FROM OLD.metadata->'kind' AND NEW.metadata->'keywords' IS NOT DISTINCT FROM OLD.metadata->'keywords' THEN RETURN NEW; END IF;
 SELECT current_id INTO parent FROM public.crm_reference_state WHERE entry_id=NEW.id FOR UPDATE;
 INSERT INTO public.crm_reference_versions(entry_id,parent_id,source,title,content,kind,keywords,origin,confirmed,actor_uid)
  VALUES(NEW.id,parent,CASE WHEN TG_OP='INSERT' THEN 'original' ELSE 'manual' END,NEW.scenario,NEW.response_logic,
   coalesce(NEW.metadata->>'kind','wording'),coalesce(NEW.metadata->'keywords','[]'),coalesce(NEW.metadata->>'origin',''),true,coalesce(NEW.updated_by,'legacy')) RETURNING id INTO vid;
 INSERT INTO public.crm_reference_state(entry_id,current_id) VALUES(NEW.id,vid)
  ON CONFLICT(entry_id) DO UPDATE SET current_id=vid,updated_at=clock_timestamp();
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.crm_reference_capture_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reference_capture_v1() TO service_role;
CREATE TRIGGER reference_capture AFTER INSERT OR UPDATE ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.crm_reference_capture_v1();

CREATE FUNCTION public.crm_reference_workflow_v1(p_operation text,p_actor_uid text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
#variable_conflict use_column
DECLARE st public.crm_reference_state%ROWTYPE; v public.crm_reference_versions%ROWTYPE;
 j public.crm_reference_jobs%ROWTYPE; preview public.crm_reference_previews%ROWTYPE;
 rid bigint; row jsonb; saved_row jsonb; rows jsonb; ids bigint[]; requested_lane text; batch uuid; manifest uuid[]:='{}'; count_n int:=0; pref text; vid bigint;
BEGIN
 IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REFERENCE_DENIED'; END IF;
 IF p_operation='preferences' THEN
  IF p_data ? 'body' THEN
   INSERT INTO public.crm_reference_preferences(actor_uid,body) VALUES(p_actor_uid,p_data->>'body') ON CONFLICT(actor_uid) DO UPDATE SET body=EXCLUDED.body,updated_at=clock_timestamp();
  END IF;
  RETURN jsonb_build_object('ok',true,'body',coalesce((SELECT body FROM public.crm_reference_preferences WHERE actor_uid=p_actor_uid),''));
 ELSIF p_operation='states' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('newCount',(SELECT count(*) FROM public.crm_reference_versions v WHERE v.entry_id=s.entry_id AND NOT v.confirmed))),'[]') INTO rows
   FROM public.crm_reference_state s JOIN public.playbooks p ON p.id=s.entry_id WHERE p.deleted_at IS NULL;
  RETURN jsonb_build_object('ok',true,'rows',rows);
 ELSIF p_operation='versions' THEN
  rid=(p_data->>'id')::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.playbooks WHERE id=rid AND deleted_at IS NULL AND metadata->>'usage'='communication_reference') THEN RAISE EXCEPTION 'REFERENCE_NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]') INTO rows FROM
   (SELECT * FROM public.crm_reference_versions WHERE entry_id=rid AND id<coalesce((p_data->>'beforeId')::bigint,9223372036854775807) ORDER BY id DESC LIMIT 51) x;
  RETURN jsonb_build_object('ok',true,'rows',rows,'state',(SELECT to_jsonb(s) FROM public.crm_reference_state s WHERE entry_id=rid));
 ELSIF p_operation='flags' THEN
  requested_lane=p_data->>'lane';
  IF requested_lane IS NULL OR requested_lane NOT IN ('system','gpt') OR jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  IF jsonb_array_length(p_data->'ids') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(p_data->'ids') LOOP
   rid=(row#>>'{}')::bigint;
   PERFORM 1 FROM public.playbooks WHERE id=rid AND deleted_at IS NULL AND metadata->>'usage'='communication_reference' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_NOT_FOUND'; END IF;
   SELECT * INTO STRICT st FROM public.crm_reference_state WHERE entry_id=rid FOR UPDATE;
   IF (CASE requested_lane WHEN 'system' THEN st.want_system ELSE st.want_gpt END) = (p_data->>'enabled')::boolean THEN CONTINUE; END IF;
   IF requested_lane='system' THEN
    UPDATE public.crm_reference_state SET want_system=(p_data->>'enabled')::boolean,system_epoch=system_epoch+1,updated_at=clock_timestamp() WHERE entry_id=rid;
   ELSE UPDATE public.crm_reference_state SET want_gpt=(p_data->>'enabled')::boolean,gpt_epoch=gpt_epoch+1,updated_at=clock_timestamp() WHERE entry_id=rid; END IF;
   UPDATE public.crm_reference_jobs SET status='cancelled',updated_at=clock_timestamp() WHERE entry_id=rid AND lane=requested_lane AND status IN ('queued','running','failed');
  END LOOP;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='instruction' THEN
  IF jsonb_typeof(p_data->'body') IS DISTINCT FROM 'string' OR length(p_data->>'body')>1000 THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  UPDATE public.crm_reference_state SET instruction=p_data->>'body',updated_at=clock_timestamp() WHERE entry_id=(p_data->>'id')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='start' THEN
  requested_lane=p_data->>'lane';batch=(p_data->>'requestId')::uuid;
  IF requested_lane IS NULL OR requested_lane NOT IN ('system','gpt') OR batch IS NULL THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('references:'||requested_lane,0));
  IF EXISTS(SELECT 1 FROM public.crm_reference_batches WHERE id=batch) THEN
   SELECT selected INTO count_n FROM public.crm_reference_batches WHERE id=batch AND actor_uid=p_actor_uid AND lane=requested_lane;
   IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_DENIED'; END IF;
   RETURN jsonb_build_object('ok',true,'batchId',batch,'selected',count_n,'duplicate',true);
  END IF;
  INSERT INTO public.crm_reference_batches(id,actor_uid,lane) VALUES(batch,p_actor_uid,requested_lane);
  SELECT coalesce(body,'') INTO pref FROM public.crm_reference_preferences WHERE actor_uid=p_actor_uid;
  FOR st IN SELECT s.* FROM public.crm_reference_state s JOIN public.playbooks p ON p.id=s.entry_id
    WHERE p.deleted_at IS NULL AND CASE requested_lane WHEN 'system' THEN s.want_system ELSE s.want_gpt END ORDER BY s.entry_id FOR UPDATE OF s LOOP
   SELECT * INTO STRICT v FROM public.crm_reference_versions WHERE id=st.current_id;
   INSERT INTO public.crm_reference_jobs(batch_id,actor_uid,entry_id,lane,epoch,base_id,input)
    VALUES(batch,p_actor_uid,st.entry_id,requested_lane,CASE requested_lane WHEN 'system' THEN st.system_epoch ELSE st.gpt_epoch END,v.id,
     jsonb_build_object('basis',to_jsonb(v),'instruction',st.instruction,'preferences',coalesce(pref,''),
       'original',(SELECT to_jsonb(o) FROM public.crm_reference_versions o WHERE o.entry_id=st.entry_id AND o.source='original' ORDER BY id LIMIT 1),
       'edits',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT title,content,note FROM public.crm_reference_versions WHERE entry_id=st.entry_id AND confirmed AND source='manual' ORDER BY id DESC LIMIT 3) e),'[]')))
    ON CONFLICT(entry_id,lane,epoch) DO NOTHING;
   SELECT id INTO j.id FROM public.crm_reference_jobs WHERE entry_id=st.entry_id AND actor_uid=p_actor_uid AND lane=requested_lane
    AND epoch=(CASE requested_lane WHEN 'system' THEN st.system_epoch ELSE st.gpt_epoch END);
   IF FOUND THEN manifest=array_append(manifest,j.id);count_n=count_n+1; END IF;
  END LOOP;
  UPDATE public.crm_reference_batches SET selected=count_n,job_ids=manifest WHERE id=batch;
  RETURN jsonb_build_object('ok',true,'batchId',batch,'selected',count_n);
 ELSIF p_operation='parseStart' THEN
  PERFORM 1 FROM public.knowledge_manual_imports WHERE id=(p_data->>'id')::uuid AND actor_uid=p_actor_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE_DENIED'; END IF;
  INSERT INTO public.crm_reference_jobs(batch_id,actor_uid,lane,input)
   VALUES(gen_random_uuid(),p_actor_uid,'parse',jsonb_build_object('documentId',p_data->>'id')) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT j FROM public.crm_reference_jobs WHERE actor_uid=p_actor_uid AND lane='parse' AND input->>'documentId'=p_data->>'id' FOR UPDATE;
  IF coalesce((p_data->>'retry')::boolean,false) AND j.status IN ('failed','completed') THEN
   UPDATE public.crm_reference_jobs SET status='queued',output=CASE WHEN status='completed' THEN NULL ELSE output END,last_error=NULL,lease=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  END IF;
  RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)-'lease');
 ELSIF p_operation='parseProgress' THEN
  SELECT * INTO STRICT j FROM public.crm_reference_jobs WHERE id=(p_data->>'jobId')::uuid AND lane='parse' FOR UPDATE;
  IF j.status<>'running' OR j.lease IS NULL OR j.lease IS DISTINCT FROM (p_data->>'lease')::uuid THEN RAISE EXCEPTION 'REFERENCE_LEASE'; END IF;
  IF jsonb_typeof(p_data->'output') IS DISTINCT FROM 'object' OR octet_length((p_data->'output')::text)>2097152 THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  UPDATE public.crm_reference_jobs SET output=p_data->'output',status=CASE WHEN (p_data->>'done')::boolean THEN 'completed' ELSE 'queued' END,lease=NULL,updated_at=clock_timestamp() WHERE id=j.id;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='jobs' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO rows FROM
   (SELECT id,batch_id,entry_id,lane,status,last_error,result_id,created_at,updated_at FROM public.crm_reference_jobs WHERE actor_uid=p_actor_uid
    AND (NOT(p_data?'batchId') OR id=ANY((SELECT unnest(job_ids) FROM public.crm_reference_batches WHERE id=(p_data->>'batchId')::uuid AND actor_uid=p_actor_uid))) ORDER BY created_at DESC,id OFFSET coalesce((p_data->>'offset')::int,0) LIMIT 51) x;
  RETURN jsonb_build_object('ok',true,'rows',rows,'counts',(SELECT coalesce(jsonb_object_agg(status,n),'{}') FROM
   (SELECT status,count(*) n FROM public.crm_reference_jobs WHERE actor_uid=p_actor_uid AND (NOT(p_data?'batchId') OR id=ANY((SELECT unnest(job_ids) FROM public.crm_reference_batches WHERE id=(p_data->>'batchId')::uuid AND actor_uid=p_actor_uid))) GROUP BY status) counts));
 ELSIF p_operation='retry' THEN
  UPDATE public.crm_reference_jobs SET status='queued',last_error=NULL,lease=NULL,updated_at=clock_timestamp()
   WHERE actor_uid=p_actor_uid AND status='failed' AND id=(p_data->>'jobId')::uuid;
  RETURN jsonb_build_object('ok',true,'changed',FOUND);
 ELSIF p_operation='claim' THEN
  -- Only the internal worker calls this operation. GPT uses actor-scoped packages.
  UPDATE public.crm_reference_jobs SET status='failed',last_error='WORKER_INTERRUPTED',updated_at=clock_timestamp()
   WHERE lane IN ('system','parse') AND status='running' AND lease_at<clock_timestamp()-interval '8 minutes';
  SELECT * INTO j FROM public.crm_reference_jobs WHERE lane IN ('system','parse') AND status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL); END IF;
  UPDATE public.crm_reference_jobs SET status='running',lease=gen_random_uuid(),lease_at=clock_timestamp(),attempts=attempts+1,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('ok',true,'job',to_jsonb(j));
 ELSIF p_operation='gptPackage' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO rows FROM
   (SELECT j.id,j.entry_id,j.base_id,j.input FROM public.crm_reference_jobs j JOIN public.crm_reference_state s ON s.entry_id=j.entry_id
     JOIN public.playbooks p ON p.id=j.entry_id WHERE j.actor_uid=p_actor_uid AND j.lane='gpt' AND j.status IN ('queued','running')
     AND j.id=ANY((SELECT unnest(job_ids) FROM public.crm_reference_batches WHERE id=(p_data->>'batchId')::uuid AND actor_uid=p_actor_uid)) AND s.want_gpt AND s.gpt_epoch=j.epoch AND p.deleted_at IS NULL
     AND j.id>coalesce((p_data->>'afterId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY j.id LIMIT 6) x;
  RETURN jsonb_build_object('ok',true,'rows',rows,'completeInputs',true);
 ELSIF p_operation IN ('finish','gptSave','fail') THEN
  SELECT * INTO STRICT j FROM public.crm_reference_jobs WHERE id=(p_data->>'jobId')::uuid FOR UPDATE;
  IF p_operation='gptSave' THEN
   IF j.actor_uid<>p_actor_uid OR j.lane<>'gpt' THEN RAISE EXCEPTION 'REFERENCE_DENIED'; END IF;
  ELSIF j.lease IS NULL OR j.lease IS DISTINCT FROM (p_data->>'lease')::uuid THEN RAISE EXCEPTION 'REFERENCE_LEASE'; END IF;
  IF j.status='completed' THEN RETURN jsonb_build_object('ok',true,'versionId',j.result_id,'duplicate',true); END IF;
  IF j.status NOT IN ('queued','running') THEN RAISE EXCEPTION 'REFERENCE_CANCELLED'; END IF;
  IF p_operation='fail' THEN
   UPDATE public.crm_reference_jobs SET status='failed',last_error=left(p_data->>'error',100),updated_at=clock_timestamp() WHERE id=j.id;
   RETURN jsonb_build_object('ok',true);
  END IF;
  SELECT * INTO STRICT st FROM public.crm_reference_state WHERE entry_id=j.entry_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.playbooks WHERE id=j.entry_id AND deleted_at IS NULL) OR
   NOT (CASE j.lane WHEN 'gpt' THEN st.want_gpt ELSE st.want_system END) OR j.epoch<>(CASE j.lane WHEN 'gpt' THEN st.gpt_epoch ELSE st.system_epoch END) THEN RAISE EXCEPTION 'REFERENCE_CANCELLED'; END IF;
  SELECT * INTO STRICT v FROM public.crm_reference_versions WHERE id=j.base_id;
  IF jsonb_typeof(p_data->'content') IS DISTINCT FROM 'string' OR jsonb_typeof(p_data->'title') IS DISTINCT FROM 'string' OR length(btrim(p_data->>'content')) NOT BETWEEN 1 AND 4000 OR length(btrim(p_data->>'title')) NOT BETWEEN 1 AND 160 OR length(coalesce(p_data->>'note',''))>2000 THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  IF btrim(p_data->>'content')=btrim(v.content) AND btrim(p_data->>'title')=btrim(v.title) THEN vid=NULL;
  ELSE
   INSERT INTO public.crm_reference_versions(entry_id,parent_id,source,title,content,kind,keywords,note,origin,actor_uid,model_info)
    VALUES(j.entry_id,j.base_id,j.lane,btrim(p_data->>'title'),btrim(p_data->>'content'),v.kind,v.keywords,coalesce(p_data->>'note',''),v.origin,j.actor_uid,coalesce(p_data->'modelInfo','{}')) RETURNING id INTO vid;
  END IF;
  UPDATE public.crm_reference_jobs SET status='completed',result_id=vid,updated_at=clock_timestamp() WHERE id=j.id;
  IF j.lane='gpt' THEN UPDATE public.crm_reference_state SET want_gpt=false WHERE entry_id=j.entry_id;
  ELSE UPDATE public.crm_reference_state SET want_system=false WHERE entry_id=j.entry_id; END IF;
  RETURN jsonb_build_object('ok',true,'versionId',vid,'unchanged',vid IS NULL);
 ELSIF p_operation='edit' THEN
  SELECT * INTO STRICT v FROM public.crm_reference_versions WHERE id=(p_data->>'versionId')::bigint;
  SELECT * INTO STRICT st FROM public.crm_reference_state WHERE entry_id=v.entry_id FOR UPDATE;
  IF st.current_id IS DISTINCT FROM (p_data->>'expectedCurrentId')::bigint THEN RAISE EXCEPTION 'REFERENCE_STALE'; END IF;
  INSERT INTO public.crm_reference_versions(entry_id,parent_id,source,title,content,kind,keywords,note,origin,confirmed,actor_uid)
   VALUES(v.entry_id,v.id,'manual',btrim(p_data->>'title'),btrim(p_data->>'content'),v.kind,v.keywords,left(coalesce(p_data->>'note',''),2000),v.origin,true,p_actor_uid) RETURNING id INTO vid;
  RETURN public.crm_reference_workflow_v1('select',p_actor_uid,jsonb_build_object('versionId',vid,'expectedCurrentId',st.current_id,'pin',st.pinned));
 ELSIF p_operation='select' THEN
  SELECT * INTO STRICT v FROM public.crm_reference_versions WHERE id=(p_data->>'versionId')::bigint;
  SELECT * INTO STRICT st FROM public.crm_reference_state WHERE entry_id=v.entry_id FOR UPDATE;
  IF st.current_id IS DISTINCT FROM (p_data->>'expectedCurrentId')::bigint THEN RAISE EXCEPTION 'REFERENCE_STALE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.playbooks WHERE id=v.entry_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'REFERENCE_NOT_FOUND'; END IF;
  UPDATE public.crm_reference_versions SET confirmed=true WHERE id=v.id;
  IF coalesce((p_data->>'latest')::boolean,false) THEN SELECT * INTO STRICT v FROM public.crm_reference_versions WHERE entry_id=v.entry_id AND confirmed ORDER BY id DESC LIMIT 1; END IF;
  PERFORM set_config('crm.reference_apply',v.id::text,true);
  UPDATE public.playbooks SET scenario=v.title,objection=v.title,response_logic=v.content,
   metadata=metadata||jsonb_build_object('kind',v.kind,'keywords',v.keywords,'summary',left(v.content,180)),
   version_no=version_no+1,content_state='{}',gpt_summary=NULL,selected_content_source='original',updated_by=p_actor_uid,updated_at=clock_timestamp() WHERE id=v.entry_id;
  PERFORM set_config('crm.reference_apply','',true);
  UPDATE public.crm_reference_state SET current_id=v.id,pinned=coalesce((p_data->>'pin')::boolean,false),updated_at=clock_timestamp() WHERE entry_id=v.entry_id;
  RETURN jsonb_build_object('ok',true,'versionId',v.id);
 ELSIF p_operation='adoptPreview' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('entryId',s.entry_id,'versionId',v.id,'expectedCurrentId',s.current_id,'title',v.title,'before',b.content,'after',v.content,'note',v.note)),'[]') INTO rows
   FROM public.crm_reference_state s JOIN public.crm_reference_versions b ON b.id=s.current_id
   JOIN LATERAL(SELECT * FROM public.crm_reference_versions WHERE entry_id=s.entry_id AND NOT confirmed AND parent_id=s.current_id ORDER BY id DESC LIMIT 1) v ON true
   JOIN public.playbooks p ON p.id=s.entry_id WHERE NOT s.pinned AND p.deleted_at IS NULL;
  INSERT INTO public.crm_reference_previews(actor_uid,preview_rows) VALUES(p_actor_uid,rows) RETURNING * INTO preview;
  RETURN jsonb_build_object('ok',true,'previewId',preview.id,'rows',rows);
 ELSIF p_operation='adoptConfirm' THEN
  SELECT * INTO STRICT preview FROM public.crm_reference_previews WHERE id=(p_data->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
  IF preview.result IS NOT NULL THEN RETURN preview.result; END IF;
  IF preview.expires_at<clock_timestamp() OR jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'REFERENCE_PREVIEW_EXPIRED'; END IF;
  IF jsonb_array_length(p_data->'ids') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'REFERENCE_INVALID'; END IF;
  FOR row IN SELECT DISTINCT value FROM jsonb_array_elements(p_data->'ids') ORDER BY value LOOP
   SELECT x INTO saved_row FROM jsonb_array_elements(preview.preview_rows) x WHERE (x->>'versionId')::bigint=(row#>>'{}')::bigint;
   IF saved_row IS NULL THEN RAISE EXCEPTION 'REFERENCE_PREVIEW_REQUIRED'; END IF;
   SELECT * INTO STRICT st FROM public.crm_reference_state WHERE entry_id=(saved_row->>'entryId')::bigint FOR UPDATE;
   IF st.pinned OR st.current_id IS DISTINCT FROM (saved_row->>'expectedCurrentId')::bigint THEN RAISE EXCEPTION 'REFERENCE_STALE'; END IF;
   PERFORM public.crm_reference_workflow_v1('select',p_actor_uid,jsonb_build_object('versionId',saved_row->'versionId','expectedCurrentId',st.current_id,'pin',false));
   count_n=count_n+1;
  END LOOP;
  rows=jsonb_build_object('ok',true,'adopted',count_n);
  UPDATE public.crm_reference_previews SET result=rows WHERE id=preview.id;
  RETURN rows;
 END IF;
 RAISE EXCEPTION 'REFERENCE_INVALID_OPERATION';
END $f$;
REVOKE ALL ON FUNCTION public.crm_reference_workflow_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reference_workflow_v1(text,text,jsonb) TO service_role;
COMMIT;
