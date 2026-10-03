-- WP07: test-account Quick Capture V2 command receipt and atomic business execution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.quick_capture_v2_commands') IS NOT NULL OR
     to_regprocedure('public.quick_capture_v2_command_v1(text,text,uuid,bigint,text,jsonb,text,bigint,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'WP07 objects already exist; inspect before migrating';
  END IF;
END $guard$;

CREATE TABLE public.quick_capture_v2_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  selected_display_name text NOT NULL,
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  ai_task_id bigint REFERENCES public.ai_tasks(id) ON DELETE RESTRICT,
  ai_result_id bigint UNIQUE REFERENCES public.ai_results(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','previewed','confirmed','executed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  preview_hash text,
  person_updated_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  interaction_id bigint UNIQUE REFERENCES public.interactions(id) ON DELETE RESTRICT,
  result_ids jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quick_capture_v2_commands_actor_idx ON public.quick_capture_v2_commands(actor_uid,created_at DESC);
ALTER TABLE public.quick_capture_v2_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_capture_v2_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY quick_capture_v2_commands_service_only ON public.quick_capture_v2_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.quick_capture_v2_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.quick_capture_v2_commands TO service_role;

CREATE FUNCTION public.quick_capture_v2_command_v1(
  p_stage text, p_actor_uid text, p_command_id uuid DEFAULT NULL,
  p_person_id bigint DEFAULT NULL, p_selected_display_name text DEFAULT NULL,
  p_draft jsonb DEFAULT NULL, p_preview_hash text DEFAULT NULL,
  p_ai_task_id bigint DEFAULT NULL, p_ai_result_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_cmd public.quick_capture_v2_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_interaction jsonb;
  v_item jsonb;
  v_id bigint;
  v_interaction_id bigint;
  v_context_ids jsonb := '[]'::jsonb;
  v_action_ids jsonb := '[]'::jsonb;
  v_commitment_ids jsonb := '[]'::jsonb;
  v_kind text;
  v_limit integer;
  v_hash text;
  v_result jsonb;
  v_at timestamptz;
  v_due timestamptz;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_stage IS NULL OR p_stage NOT IN ('plan','preview','confirm','execute') THEN
    RAISE EXCEPTION 'Invalid Quick Capture command' USING ERRCODE='22023';
  END IF;
  IF p_stage = 'plan' THEN
    IF p_command_id IS NOT NULL OR p_preview_hash IS NOT NULL OR p_person_id IS NULL OR
       p_selected_display_name IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR
       length(p_draft::text) > 30000 OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN
         ('interaction','facts','signals','actions','commitments')) OR
       (SELECT count(*) FROM jsonb_object_keys(p_draft)) <> 5 THEN
      RAISE EXCEPTION 'Invalid Quick Capture draft' USING ERRCODE='22023';
    END IF;
    v_interaction := p_draft->'interaction';
    IF jsonb_typeof(v_interaction) IS DISTINCT FROM 'object' OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(v_interaction) k WHERE k NOT IN
         ('type','at','channel','summary','rawNote')) OR
       (SELECT count(*) FROM jsonb_object_keys(v_interaction)) <> 5 OR
       length(btrim(v_interaction->>'type')) NOT BETWEEN 1 AND 64 OR
       length(btrim(v_interaction->>'summary')) NOT BETWEEN 1 AND 2000 OR
       length(v_interaction->>'rawNote') NOT BETWEEN 1 AND 10000 OR
       length(v_interaction->>'channel') > 100 OR
       (v_interaction->>'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$' THEN
      RAISE EXCEPTION 'Invalid Interaction draft' USING ERRCODE='22023';
    END IF;
    v_at := (v_interaction->>'at')::timestamptz;
    FOREACH v_kind IN ARRAY ARRAY['facts','signals','actions','commitments'] LOOP
      v_limit := 10;
      IF v_kind='facts' THEN v_limit := 20;
      ELSIF v_kind='signals' THEN v_limit := 12;
      END IF;
      IF jsonb_typeof(p_draft->v_kind) IS DISTINCT FROM 'array' OR
         jsonb_array_length(p_draft->v_kind) > v_limit THEN
        RAISE EXCEPTION 'Invalid candidate list' USING ERRCODE='22023';
      END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_draft->v_kind) LOOP
        IF (v_kind IN ('facts','signals') AND
            (jsonb_typeof(v_item) IS DISTINCT FROM 'string' OR
             length(btrim(v_item #>> '{}')) NOT BETWEEN 1 AND 500)) OR
           (v_kind='actions' AND
            (jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR
             length(btrim(v_item->>'title')) NOT BETWEEN 1 AND 200 OR
             length(coalesce(v_item->>'description','')) > 4000 OR
             coalesce(v_item->>'priority','medium') NOT IN ('low','medium','high','urgent') OR
             EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN
               ('title','description','dueAt','priority')))) OR
           (v_kind='commitments' AND
            (jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR
             v_item->>'type' NOT IN ('I_PROMISED','THEY_PROMISED','MUTUAL') OR
             length(btrim(v_item->>'content')) NOT BETWEEN 1 AND 4000 OR
             EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN
               ('type','content','dueAt')))) THEN
          RAISE EXCEPTION 'Invalid candidate item' USING ERRCODE='22023';
        END IF;
        IF v_kind IN ('actions','commitments') AND nullif(v_item->>'dueAt','') IS NOT NULL THEN
          IF (v_item->>'dueAt') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
            RAISE EXCEPTION 'Invalid due date' USING ERRCODE='22023';
          END IF;
          v_due := (v_item->>'dueAt')::timestamptz;
        END IF;
      END LOOP;
    END LOOP;
    SELECT * INTO v_person FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_person.display_name IS DISTINCT FROM p_selected_display_name OR
       NOT EXISTS (SELECT 1 FROM public.crm_test_records r WHERE r.record_table='persons'
         AND r.record_id=p_person_id::text AND r.batch_key='crm_test_main_v1') THEN
      RAISE EXCEPTION 'Selected test Person changed' USING ERRCODE='42501';
    END IF;
    IF p_ai_task_id IS NULL OR p_ai_result_id IS NULL OR NOT EXISTS
      (SELECT 1 FROM public.ai_results ar JOIN public.ai_tasks at ON at.id=ar.task_id
       WHERE ar.id=p_ai_result_id AND ar.task_id=p_ai_task_id AND
         at.task_type='quick_capture_v2' AND at.context_snapshot->>'actor_uid'=p_actor_uid AND
         at.input_snapshot->>'text'=v_interaction->>'rawNote' AND
         at.created_at > now()-interval '1 hour') THEN
      RAISE EXCEPTION 'Invalid AI audit reference' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.quick_capture_v2_commands
      (actor_uid,person_id,selected_display_name,draft,ai_task_id,ai_result_id)
    VALUES(p_actor_uid,p_person_id,p_selected_display_name,p_draft,p_ai_task_id,p_ai_result_id)
    RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','planned','commandId',v_cmd.id,
      'version',v_cmd.version,'businessDataWritten',false);
  END IF;
  IF p_command_id IS NULL OR p_person_id IS NOT NULL OR p_selected_display_name IS NOT NULL OR
     p_draft IS NOT NULL OR p_ai_task_id IS NOT NULL OR p_ai_result_id IS NOT NULL THEN
    RAISE EXCEPTION 'Command ID required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cmd FROM public.quick_capture_v2_commands WHERE id=p_command_id FOR UPDATE;
  IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Command not found for actor' USING ERRCODE='42501';
  END IF;
  IF p_stage='execute' AND v_cmd.status='executed' THEN
    RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
      'resultIds',v_cmd.result_ids,'replayed',true,'businessDataWritten',false);
  END IF;
  IF v_cmd.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Preview expired' USING ERRCODE='40001';
  END IF;
  IF p_stage='preview' THEN
    IF v_cmd.status NOT IN ('planned','previewed') OR p_preview_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Preview unavailable' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_person FROM public.persons WHERE id=v_cmd.person_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_person.display_name IS DISTINCT FROM v_cmd.selected_display_name OR
       NOT EXISTS (SELECT 1 FROM public.crm_test_records r WHERE r.record_table='persons'
         AND r.record_id=v_cmd.person_id::text AND r.batch_key='crm_test_main_v1') THEN
      RAISE EXCEPTION 'Selected Person changed' USING ERRCODE='40001';
    END IF;
    v_hash := md5(v_cmd.id::text||v_cmd.actor_uid||v_cmd.draft::text||
      coalesce(v_person.updated_at::text,'')||(v_cmd.version+1)::text||v_cmd.expires_at::text);
    UPDATE public.quick_capture_v2_commands SET status='previewed',version=version+1,
      person_updated_at=v_person.updated_at,preview_hash=v_hash,updated_at=now()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
      'version',v_cmd.version,'previewHash',v_hash,'expiresAt',v_cmd.expires_at,
      'preview',jsonb_build_object('personId',v_cmd.person_id,'displayName',v_cmd.selected_display_name,
        'interaction',v_cmd.draft->'interaction','facts',v_cmd.draft->'facts',
        'signals',v_cmd.draft->'signals','actions',v_cmd.draft->'actions',
        'commitments',v_cmd.draft->'commitments','aiTaskId',v_cmd.ai_task_id,
        'aiResultId',v_cmd.ai_result_id,'notice','含测试数据'),
      'businessDataWritten',false);
  END IF;
  IF p_stage='confirm' THEN
    IF v_cmd.status IN ('confirmed','executed') AND p_preview_hash=v_cmd.preview_hash THEN
      RETURN jsonb_build_object('ok',true,'status',v_cmd.status,'commandId',v_cmd.id,
        'replayed',true,'businessDataWritten',false);
    END IF;
    IF v_cmd.status<>'previewed' OR p_preview_hash IS NULL OR
       p_preview_hash IS DISTINCT FROM v_cmd.preview_hash THEN
      RAISE EXCEPTION 'Server preview confirmation required' USING ERRCODE='42501';
    END IF;
    UPDATE public.quick_capture_v2_commands SET status='confirmed',confirmed_at=now(),updated_at=now()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','confirmed','commandId',v_cmd.id,
      'businessDataWritten',false);
  END IF;
  IF v_cmd.status<>'confirmed' OR p_preview_hash IS NOT NULL OR v_cmd.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Human confirmation required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.display_name IS DISTINCT FROM v_cmd.selected_display_name OR
     v_person.updated_at IS DISTINCT FROM v_cmd.person_updated_at OR
     NOT EXISTS (SELECT 1 FROM public.crm_test_records r WHERE r.record_table='persons'
       AND r.record_id=v_cmd.person_id::text AND r.batch_key='crm_test_main_v1') THEN
    RAISE EXCEPTION 'Person changed since preview' USING ERRCODE='40001';
  END IF;
  v_interaction := v_cmd.draft->'interaction';
  INSERT INTO public.interactions(person_id,interaction_type,interaction_at,channel,summary,raw_note,
    source_type,created_by_uid)
  VALUES(v_cmd.person_id,v_interaction->>'type',(v_interaction->>'at')::timestamptz,
    nullif(v_interaction->>'channel',''),v_interaction->>'summary',v_interaction->>'rawNote',
    'manual',p_actor_uid) RETURNING id INTO v_interaction_id;
  FOR v_kind IN SELECT unnest(ARRAY['facts','signals']) LOOP
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_cmd.draft->v_kind) LOOP
      INSERT INTO public.context_items(person_id,interaction_id,item_type,category,content,
        source_type,source_id,confirmed)
      VALUES(v_cmd.person_id,v_interaction_id,CASE v_kind WHEN 'facts' THEN 'fact' ELSE 'signal' END,
        'quick_capture',v_item #>> '{}','ai_quick_capture_v2',v_interaction_id,false)
      RETURNING id INTO v_id;
      v_context_ids := v_context_ids||to_jsonb(v_id);
    END LOOP;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_cmd.draft->'actions') LOOP
    INSERT INTO public.actions(person_id,interaction_id,action_type,title,description,due_at,
      priority,status,source,created_by_uid,confirmed_by_uid,confirmed_at)
    VALUES(v_cmd.person_id,v_interaction_id,'quick_capture',v_item->>'title',
      nullif(v_item->>'description',''),nullif(v_item->>'dueAt','')::timestamptz,
      coalesce(v_item->>'priority','medium'),'open','ai_quick_capture_v2',
      p_actor_uid,p_actor_uid,v_cmd.confirmed_at) RETURNING id INTO v_id;
    v_action_ids := v_action_ids||to_jsonb(v_id);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_cmd.draft->'commitments') LOOP
    INSERT INTO public.commitments(person_id,interaction_id,commitment_type,content,due_at,
      status,source,created_by_uid,confirmed_by_uid,confirmed_at)
    VALUES(v_cmd.person_id,v_interaction_id,v_item->>'type',v_item->>'content',
      nullif(v_item->>'dueAt','')::timestamptz,'open','ai_quick_capture_v2',
      p_actor_uid,p_actor_uid,v_cmd.confirmed_at) RETURNING id INTO v_id;
    v_commitment_ids := v_commitment_ids||to_jsonb(v_id);
  END LOOP;
  v_result := jsonb_build_object('interactionId',v_interaction_id,'contextItemIds',v_context_ids,
    'actionIds',v_action_ids,'commitmentIds',v_commitment_ids,
    'aiTaskId',v_cmd.ai_task_id,'aiResultId',v_cmd.ai_result_id);
  UPDATE public.quick_capture_v2_commands SET status='executed',interaction_id=v_interaction_id,
    result_ids=v_result,updated_at=now() WHERE id=v_cmd.id;
  RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
    'resultIds',v_result,'replayed',false,'businessDataWritten',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.quick_capture_v2_command_v1(text,text,uuid,bigint,text,jsonb,text,bigint,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quick_capture_v2_command_v1(text,text,uuid,bigint,text,jsonb,text,bigint,bigint)
  TO service_role;
COMMIT;
