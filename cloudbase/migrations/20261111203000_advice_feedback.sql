BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE public.crm_advice_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL,
  lane text NOT NULL CHECK (lane IN ('system','gpt','activity')),
  subject_id bigint NOT NULL,
  advice_id bigint NOT NULL,
  version_key text NOT NULL,
  snapshot jsonb NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted','modified','rejected','outcome')),
  note text NOT NULL DEFAULT '',
  evidence text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
  confirmed_at timestamptz
);
CREATE INDEX crm_advice_feedback_history_idx ON public.crm_advice_feedback
  (subject_id,advice_id,lane,confirmed_at DESC) WHERE confirmed_at IS NOT NULL;
ALTER TABLE public.crm_advice_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_advice_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_advice_feedback_service_only ON public.crm_advice_feedback
  FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.crm_advice_feedback FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_advice_feedback TO service_role;

CREATE FUNCTION public.crm_advice_feedback_v1(p_actor_uid text,p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE
  v public.crm_advice_feedback%ROWTYPE;
  prior public.crm_advice_feedback%ROWTYPE;
  a public.person_followup_advice%ROWTYPE;
  lane_name text; subject bigint; advice bigint; snap jsonb; version_key text;
  result_id bigint; rows_json jsonb; facts jsonb:='[]'::jsonb; choice text; note_text text; evidence_text text;
BEGIN
  IF length(btrim(coalesce(p_actor_uid,''))) NOT BETWEEN 1 AND 128 OR
     p_operation IS NULL OR p_operation NOT IN ('read','preview','confirm') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'Invalid feedback request'; END IF;
  IF p_operation='confirm' THEN
    SELECT * INTO STRICT v FROM public.crm_advice_feedback WHERE id=(p_input->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
    IF v.confirmed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'id',v.id,'replayed',true); END IF;
    IF v.expires_at<=now() THEN RAISE EXCEPTION 'Expired preview'; END IF;
    lane_name:=v.lane; subject:=v.subject_id; advice:=v.advice_id; choice:=v.decision;
  ELSE
    lane_name:=p_input->>'lane'; subject:=(p_input->>'subjectId')::bigint; advice:=(p_input->>'adviceId')::bigint;
    IF lane_name IS NULL OR lane_name NOT IN ('system','gpt','activity') OR subject IS NULL OR advice IS NULL THEN RAISE EXCEPTION 'Invalid target'; END IF;
    choice:=p_input->>'decision';
  END IF;
  IF lane_name='activity' THEN
    SELECT jsonb_build_object('title',act.name,'strategy',r.result_json->>'summary','version',r.id) INTO STRICT snap
      FROM public.activities act JOIN public.ai_tasks t ON t.subject_id=act.id::text
      JOIN public.ai_results r ON r.task_id=t.id
      WHERE act.id=subject AND act.deleted_at IS NULL AND t.task_type='activity_review' AND t.subject_type='activity'
        AND t.status='completed' AND r.id=advice FOR SHARE OF act,r,t;
  ELSE
    SELECT s.* INTO STRICT a FROM public.person_followup_advice s JOIN public.persons p ON p.id=s.person_id
      WHERE s.id=advice AND s.person_id=subject AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND s.system_status='ready' FOR SHARE OF s,p;
    IF lane_name='system' THEN
      snap:=jsonb_build_object('title',coalesce(a.system_title,a.title),'strategy',a.system_strategy,'product',a.system_product_advice,
        'strategySources',a.system_strategy_sources,'productSources',a.system_product_sources,'version',a.system_version);
    ELSE
      snap:=jsonb_build_object('title',a.gpt_title,'strategy',a.gpt_strategy,'product',a.gpt_product_advice,
        'strategySources',a.gpt_strategy_sources,'productSources',a.gpt_product_sources,'version',a.gpt_based_on_system_version);
    END IF;
    IF p_operation IN ('read','preview') AND p_input->>'updatedAt' IS NOT NULL AND a.updated_at IS DISTINCT FROM (p_input->>'updatedAt')::timestamptz THEN RAISE EXCEPTION 'Advice changed; reload'; END IF;
  END IF;
  version_key:=md5(snap::text);
  IF p_operation='read' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.confirmed_at DESC),'[]'::jsonb) INTO rows_json FROM
      (SELECT f.id,f.decision,f.note,f.evidence,f.confirmed_at,f.version_key,f.snapshot->>'version' AS version,f.snapshot->>'title' AS title
       FROM public.crm_advice_feedback f WHERE f.lane=lane_name AND f.subject_id=subject AND f.advice_id=advice
        AND f.confirmed_at IS NOT NULL ORDER BY f.confirmed_at DESC LIMIT 50) h;
    IF lane_name='system' AND a.system_version=1 THEN
      SELECT jsonb_agg(jsonb_build_object('text',left(item->>'content',500),'date',item->>'last_verified_at',
        'ref',concat('public.context_items#',item#>>'{source,id}'))) INTO facts
      FROM public.ai_tasks t CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.context_snapshot#>'{customer_snapshot,facts}')='array'
        THEN t.context_snapshot#>'{customer_snapshot,facts}' ELSE '[]'::jsonb END) item
      WHERE t.id=a.system_task_id AND t.subject_type='person' AND t.subject_id=subject::text AND t.task_type='person_followup_advice'
        AND item#>>'{source,table}'='context_items' AND item#>>'{source,id}' ~ '^[1-9][0-9]*$';
    END IF;
    RETURN jsonb_build_object('ok',true,'versionKey',version_key,'rows',rows_json,'facts',coalesce(facts,'[]'::jsonb));
  END IF;
  IF p_operation='preview' THEN
    note_text:=btrim(coalesce(p_input->>'note','')); evidence_text:=btrim(coalesce(p_input->>'evidence',''));
    IF choice IS NULL OR choice NOT IN ('accepted','modified','rejected','outcome') OR length(note_text)>2000 OR length(evidence_text)>2000
      OR (choice<>'accepted' AND note_text='') OR (choice='outcome' AND evidence_text='') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
    IF choice='outcome' AND p_input->>'priorId' IS NOT NULL THEN
      SELECT * INTO STRICT prior FROM public.crm_advice_feedback f WHERE f.id=(p_input->>'priorId')::uuid AND
        f.confirmed_at IS NOT NULL AND f.lane=lane_name AND f.subject_id=subject AND f.advice_id=advice AND f.decision IN ('accepted','modified');
      snap:=prior.snapshot; version_key:=prior.version_key;
    ELSIF snap->>'strategy' IS NULL OR p_input->>'versionKey' IS DISTINCT FROM version_key THEN RAISE EXCEPTION 'Advice changed; reload'; END IF;
    INSERT INTO public.crm_advice_feedback(actor_uid,lane,subject_id,advice_id,version_key,snapshot,decision,note,evidence)
      VALUES(p_actor_uid,lane_name,subject,advice,version_key,jsonb_build_object('title',snap->>'title','version',snap->>'version'),choice,note_text,evidence_text) RETURNING * INTO v;
    RETURN jsonb_build_object('ok',true,'previewId',v.id,'version',snap->>'version','title',snap->>'title','decision',choice,'note',v.note,'evidence',v.evidence);
  END IF;
  IF version_key<>v.version_key AND NOT (choice='outcome' AND EXISTS(SELECT 1 FROM public.crm_advice_feedback f WHERE
    f.lane=lane_name AND f.subject_id=subject AND f.advice_id=advice AND f.version_key=v.version_key AND f.decision IN ('accepted','modified') AND f.confirmed_at IS NOT NULL))
    THEN RAISE EXCEPTION 'Advice changed; preview again'; END IF;
  IF lane_name='system' AND a.system_version=1 AND choice<>'outcome' THEN
    SELECT min(r.id) INTO result_id FROM public.ai_results r JOIN public.ai_tasks t ON t.id=r.task_id
      WHERE t.id=a.system_task_id AND t.task_type='person_followup_advice' AND t.subject_type='person' AND t.subject_id=subject::text
        AND t.status='completed' HAVING count(*)=1;
    IF result_id IS NOT NULL THEN
      PERFORM public.crm_ai_experience_decide_v1(p_actor_uid,v.id,result_id,choice,nullif(v.note,''),CASE WHEN choice='modified' THEN jsonb_build_object('revision',v.note) END);
    END IF;
  ELSIF lane_name='activity' THEN
    IF choice='outcome' THEN
      PERFORM public.crm_ai_experience_outcome_v1(p_actor_uid,v.id,'activity',subject,advice,v.note,v.created_at,v.evidence);
    ELSE
      PERFORM public.crm_ai_experience_decide_v1(p_actor_uid,v.id,advice,choice,nullif(v.note,''),CASE WHEN choice='modified' THEN jsonb_build_object('revision',v.note) END);
    END IF;
  END IF;
  UPDATE public.crm_advice_feedback SET confirmed_at=now() WHERE id=v.id;
  RETURN jsonb_build_object('ok',true,'id',v.id,'replayed',false);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_advice_feedback_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_advice_feedback_v1(text,text,jsonb) TO service_role;
COMMIT;
