BEGIN;
CREATE TABLE public.knowledge_manual_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_uid text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL,
 original_base64 text NOT NULL,
 preview_id uuid, preview_at timestamptz, plan jsonb,
 applied jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_uid,sha256)
);
ALTER TABLE public.knowledge_manual_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_manual_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_manual_imports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.knowledge_manual_imports TO service_role;
CREATE POLICY manual_import_service ON public.knowledge_manual_imports TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_manual_import_v1(p_operation text,p_actor_uid text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE job public.knowledge_manual_imports%ROWTYPE; choice jsonb; item jsonb; candidate jsonb;
 idx int; target text; result jsonb; saved jsonb; payload jsonb; used_targets text[] := '{}';
 added int := 0; revised int := 0;
BEGIN
 IF current_user <> 'service_role' OR nullif(trim(p_actor_uid),'') IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
 IF p_operation='stage' THEN
  INSERT INTO public.knowledge_manual_imports(actor_uid,sha256,filename,original_base64)
   VALUES(p_actor_uid,p_data->>'sha256',p_data->>'filename',p_data->>'original')
   ON CONFLICT(actor_uid,sha256) DO NOTHING;
  SELECT * INTO STRICT job FROM public.knowledge_manual_imports WHERE actor_uid=p_actor_uid AND sha256=p_data->>'sha256';
  RETURN jsonb_build_object('id',job.id,'filename',job.filename);
 END IF;
 IF p_operation='recent' THEN
  RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC),'[]') FROM
   (SELECT id,filename,created_at FROM public.knowledge_manual_imports WHERE actor_uid=p_actor_uid ORDER BY created_at DESC LIMIT 30) s));
 END IF;
 SELECT * INTO STRICT job FROM public.knowledge_manual_imports WHERE id=(p_data->>'id')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
 IF p_operation='load' THEN RETURN jsonb_build_object('original',job.original_base64,'filename',job.filename,'sha256',job.sha256,'applied',job.applied); END IF;
 IF p_operation='preview' THEN
  IF jsonb_typeof(p_data->'plan') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'plan') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_PLAN'; END IF;
  UPDATE public.knowledge_manual_imports SET plan=p_data->'plan',preview_id=gen_random_uuid(),preview_at=clock_timestamp(),last_result=NULL
   WHERE id=job.id RETURNING preview_id INTO job.preview_id;
  RETURN jsonb_build_object('previewId',job.preview_id);
 END IF;
 IF p_operation IS DISTINCT FROM 'apply' OR job.preview_id IS NULL OR job.preview_id IS DISTINCT FROM (p_data->>'previewId')::uuid THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
 IF job.last_result IS NOT NULL THEN
  IF job.last_result->'choices' IS DISTINCT FROM p_data->'choices' THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  RETURN job.last_result->'result';
 END IF;
 IF job.preview_at < clock_timestamp()-interval '30 minutes' OR jsonb_typeof(p_data->'choices') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_data->'choices') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_SELECTION'; END IF;
 FOR choice IN SELECT value FROM jsonb_array_elements(p_data->'choices') LOOP
  idx=(choice->>'index')::int; target=choice->>'target'; item=job.plan->idx;
  IF idx IS NULL OR idx<0 OR item IS NULL OR item->>'action'='skip' OR target IS NULL OR job.applied ? (item->>'sourceKey') THEN RAISE EXCEPTION 'INVALID_SELECTION'; END IF;
  payload=item->'entry'||jsonb_build_object('table','playbooks');
  IF target='new' THEN
   IF item->>'action' NOT IN ('new','ambiguous') THEN RAISE EXCEPTION 'INVALID_SELECTION'; END IF;
   IF item->>'action'='new' AND EXISTS(SELECT 1 FROM public.playbooks
     WHERE deleted_at IS NULL AND metadata->>'usage'='communication_reference'
     AND lower(trim(scenario))=lower(trim(payload->>'title'))) THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  ELSE
   SELECT value INTO candidate FROM jsonb_array_elements(item->'matches') WHERE value->>'id'=target;
   IF candidate IS NULL OR target=ANY(used_targets) THEN RAISE EXCEPTION 'INVALID_SELECTION'; END IF;
   used_targets=array_append(used_targets,target);
   payload=payload||jsonb_build_object('id',target,'expectedUpdatedAt',candidate->>'updatedAt',
     'keywords',coalesce((SELECT metadata->'keywords' FROM public.playbooks WHERE id=target::bigint),payload->'keywords'));
  END IF;
  saved=public.crm_knowledge_maintain_v1('saveReference',p_actor_uid,payload);
  IF saved->>'skipped'='true' THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  IF target='new' THEN added=added+1; ELSE revised=revised+1; END IF;
  job.applied=job.applied||jsonb_build_object(item->>'sourceKey',jsonb_build_object('recordId',saved#>>'{row,id}',
    'updatedAt',saved#>>'{row,updated_at}','source',item#>>'{entry,origin}'));
 END LOOP;
 result=jsonb_build_object('added',added,'revised',revised);
 UPDATE public.knowledge_manual_imports SET applied=job.applied,last_result=jsonb_build_object('choices',p_data->'choices','result',result) WHERE id=job.id;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_manual_import_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_manual_import_v1(text,text,jsonb) TO service_role;
COMMIT;
