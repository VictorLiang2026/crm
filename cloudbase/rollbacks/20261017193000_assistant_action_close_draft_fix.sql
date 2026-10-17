-- PC26 corrective migration: close commands require an empty non-null JSON draft.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.assistant_action_command_v1(
  p_stage text, p_actor_uid text, p_command_id uuid DEFAULT NULL,
  p_person_id bigint DEFAULT NULL, p_draft jsonb DEFAULT NULL,
  p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_cmd public.assistant_action_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_draft jsonb;
  v_changes jsonb;
  v_preview jsonb;
  v_before jsonb;
  v_after jsonb;
  v_hash text;
  v_due timestamptz;
  v_action_id bigint;
  v_operation text;
  v_target_id bigint;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Authenticated actor is required' USING ERRCODE = '22023';
  END IF;
  IF p_stage NOT IN ('plan','preview','confirm','execute') OR p_stage IS NULL THEN
    RAISE EXCEPTION 'Unsupported command stage' USING ERRCODE = '22023';
  END IF;

  IF p_stage = 'plan' THEN
    IF p_command_id IS NOT NULL OR p_preview_hash IS NOT NULL OR
       p_person_id IS NULL OR p_person_id <= 0 OR
       jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid Action draft' USING ERRCODE = '22023';
    END IF;
    v_operation := COALESCE(p_draft->>'operation','create');
    IF v_operation = 'create' THEN
      IF p_draft ? 'operation' OR p_draft ? 'targetActionId' OR
         p_draft ? 'source' OR p_draft ? 'status' OR p_draft ? 'confirmed' OR
         (SELECT count(*) FROM jsonb_object_keys(p_draft) k) > 5 OR
         EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k
                 WHERE k NOT IN ('action_type','title','description','due_at','priority')) THEN
        RAISE EXCEPTION 'Invalid Action draft' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_draft->'action_type') IS DISTINCT FROM 'string' OR
         length(btrim(p_draft->>'action_type')) NOT BETWEEN 1 AND 64 OR
         jsonb_typeof(p_draft->'title') IS DISTINCT FROM 'string' OR
         length(btrim(p_draft->>'title')) NOT BETWEEN 1 AND 200 OR
         (p_draft ? 'description' AND p_draft->'description' <> 'null'::jsonb AND
           (jsonb_typeof(p_draft->'description') IS DISTINCT FROM 'string' OR
            length(p_draft->>'description') > 4000)) OR
         (p_draft ? 'priority' AND p_draft->>'priority' NOT IN ('low','medium','high','urgent')) OR
         (p_draft ? 'due_at' AND p_draft->'due_at' <> 'null'::jsonb AND
           (jsonb_typeof(p_draft->'due_at') IS DISTINCT FROM 'string' OR
            (p_draft->>'due_at') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$')) THEN
        RAISE EXCEPTION 'Invalid Action fields' USING ERRCODE = '22023';
      END IF;
      v_due := NULLIF(p_draft->>'due_at','')::timestamptz;
      v_draft := jsonb_build_object(
        'action_type', btrim(p_draft->>'action_type'), 'title', btrim(p_draft->>'title'),
        'description', CASE WHEN p_draft ? 'description' THEN p_draft->'description' ELSE 'null'::jsonb END,
        'due_at', to_jsonb(v_due), 'priority', COALESCE(p_draft->>'priority','medium'));
    ELSIF v_operation IN ('update','close') THEN
      IF (SELECT count(*) FROM jsonb_object_keys(p_draft) k) <> 3 OR
         EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k
                 WHERE k NOT IN ('operation','targetActionId','changes')) OR
         jsonb_typeof(p_draft->'targetActionId') IS DISTINCT FROM 'number' OR
         (p_draft->>'targetActionId') !~ '^[1-9][0-9]{0,18}$' OR
         jsonb_typeof(p_draft->'changes') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Invalid Action command' USING ERRCODE = '22023';
      END IF;
      v_target_id := (p_draft->>'targetActionId')::bigint;
      v_changes := p_draft->'changes';
      IF v_operation = 'close' THEN
        IF v_changes <> '{}'::jsonb THEN
          RAISE EXCEPTION 'Close cannot change fields' USING ERRCODE = '22023';
        END IF;
      ELSE
        IF (SELECT count(*) FROM jsonb_object_keys(v_changes)) < 1 OR
           EXISTS (SELECT 1 FROM jsonb_object_keys(v_changes) k
                   WHERE k NOT IN ('action_type','title','description','due_at','priority')) OR
           (v_changes ? 'action_type' AND (jsonb_typeof(v_changes->'action_type') IS DISTINCT FROM 'string' OR
             length(btrim(v_changes->>'action_type')) NOT BETWEEN 1 AND 64)) OR
           (v_changes ? 'title' AND (jsonb_typeof(v_changes->'title') IS DISTINCT FROM 'string' OR
             length(btrim(v_changes->>'title')) NOT BETWEEN 1 AND 200)) OR
           (v_changes ? 'description' AND v_changes->'description' <> 'null'::jsonb AND
             (jsonb_typeof(v_changes->'description') IS DISTINCT FROM 'string' OR
              length(v_changes->>'description') > 4000)) OR
           (v_changes ? 'priority' AND (jsonb_typeof(v_changes->'priority') IS DISTINCT FROM 'string' OR
             v_changes->>'priority' NOT IN ('low','medium','high','urgent'))) OR
           (v_changes ? 'due_at' AND v_changes->'due_at' <> 'null'::jsonb AND
             (jsonb_typeof(v_changes->'due_at') IS DISTINCT FROM 'string' OR
              (v_changes->>'due_at') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$')) THEN
          RAISE EXCEPTION 'Invalid Action fields' USING ERRCODE = '22023';
        END IF;
        v_draft := v_changes;
        IF v_draft ? 'action_type' THEN v_draft := jsonb_set(v_draft,'{action_type}',to_jsonb(btrim(v_draft->>'action_type'))); END IF;
        IF v_draft ? 'title' THEN v_draft := jsonb_set(v_draft,'{title}',to_jsonb(btrim(v_draft->>'title'))); END IF;
      END IF;
      PERFORM 1 FROM public.actions a
        WHERE a.id = v_target_id AND a.person_id = p_person_id
          AND a.status IN ('open','in_progress');
      IF NOT FOUND THEN RAISE EXCEPTION 'Open Action not found for Person' USING ERRCODE = '23503'; END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported Action operation' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_person FROM public.persons
      WHERE id = p_person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = '23503'; END IF;
    INSERT INTO public.assistant_action_commands(actor_uid, person_id, draft, operation, target_action_id)
      VALUES (p_actor_uid, p_person_id, v_draft, v_operation,
        CASE WHEN v_operation = 'create' THEN NULL ELSE v_target_id END)
      RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','planned','commandId',v_cmd.id,
      'version',v_cmd.version,'expiresAt',v_cmd.expires_at,'nextStep','preview',
      'businessDataWritten',false);
  END IF;

  IF p_command_id IS NULL OR p_person_id IS NOT NULL OR p_draft IS NOT NULL THEN
    RAISE EXCEPTION 'Command ID required without new draft' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_cmd FROM public.assistant_action_commands
    WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Command not found for actor' USING ERRCODE = '42501';
  END IF;
  IF v_cmd.status = 'executed' AND p_stage = 'execute' THEN
    RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
      'actionId',COALESCE(v_cmd.executed_action_id,v_cmd.target_action_id),
      'replayed',true,'businessDataWritten',false);
  END IF;
  IF v_cmd.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Command expired' USING ERRCODE = '22023';
  END IF;

  IF p_stage = 'preview' THEN
    IF v_cmd.status NOT IN ('planned','previewed') OR p_preview_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Preview stage is unavailable' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_person FROM public.persons
      WHERE id = v_cmd.person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = '23503'; END IF;
    IF v_cmd.operation = 'create' THEN
      v_due := NULLIF(v_cmd.draft->>'due_at','')::timestamptz;
      IF EXISTS (SELECT 1 FROM public.actions a WHERE a.person_id = v_cmd.person_id
        AND a.status IN ('open','in_progress')
        AND lower(btrim(a.title)) = lower(btrim(v_cmd.draft->>'title'))
        AND a.due_at IS NOT DISTINCT FROM v_due) THEN
        RAISE EXCEPTION 'Matching Action already exists' USING ERRCODE = '23505';
      END IF;
      v_preview := jsonb_build_object('operation','create','resource','actions',
        'before',NULL,'after',v_cmd.draft,
        'person',jsonb_build_object('id',v_person.id,'displayName',v_person.display_name),
        'existingDuplicate',false);
      v_hash := md5(v_cmd.id::text || v_cmd.actor_uid || v_cmd.person_id::text ||
        v_cmd.draft::text || COALESCE(v_person.updated_at::text,'') || (v_cmd.version + 1)::text);
    ELSE
      SELECT * INTO v_action FROM public.actions a
        WHERE a.id = v_cmd.target_action_id AND a.person_id = v_cmd.person_id
          AND a.status IN ('open','in_progress');
      IF NOT FOUND THEN RAISE EXCEPTION 'Open Action changed' USING ERRCODE = '40001'; END IF;
      v_before := jsonb_build_object('id',v_action.id,'action_type',v_action.action_type,
        'title',v_action.title,'description',v_action.description,'due_at',v_action.due_at,
        'priority',v_action.priority,'status',v_action.status,'updated_at',v_action.updated_at);
      IF v_cmd.operation = 'update' THEN
        v_after := v_before || v_cmd.draft;
      ELSE
        v_after := v_before || jsonb_build_object('status','completed',
          'completed_at',clock_timestamp(),'completed_by_uid',p_actor_uid);
      END IF;
      v_preview := jsonb_build_object('operation',v_cmd.operation,'resource','actions',
        'before',v_before,'after',v_after,
        'person',jsonb_build_object('id',v_person.id,'displayName',v_person.display_name),
        'targetActionId',v_action.id,'expiresAt',v_cmd.expires_at);
      v_hash := md5(v_cmd.id::text || v_cmd.actor_uid || v_cmd.person_id::text ||
        v_cmd.target_action_id::text || v_cmd.operation || v_cmd.draft::text ||
        COALESCE(v_person.updated_at::text,'') || COALESCE(v_action.updated_at::text,'') ||
        (v_cmd.version + 1)::text);
    END IF;
    UPDATE public.assistant_action_commands SET status='previewed',
      preview_json=v_preview, preview_hash=v_hash,
      person_updated_at=v_person.updated_at,
      action_updated_at=CASE WHEN v_cmd.operation='create' THEN NULL ELSE v_action.updated_at END,
      version=version+1, updated_at=now()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
      'version',v_cmd.version,'preview',v_preview,'previewHash',v_hash,
      'expiresAt',v_cmd.expires_at,'nextStep','confirm','businessDataWritten',false);
  END IF;

  IF p_stage = 'confirm' THEN
    IF v_cmd.status <> 'previewed' OR p_preview_hash IS NULL OR
       p_preview_hash <> v_cmd.preview_hash OR length(p_preview_hash) <> 32 THEN
      RAISE EXCEPTION 'Server preview confirmation required' USING ERRCODE = '42501';
    END IF;
    UPDATE public.assistant_action_commands SET status='confirmed',
      confirmed_by_uid=p_actor_uid, confirmed_at=now(), updated_at=now()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','confirmed','commandId',v_cmd.id,
      'confirmedAt',v_cmd.confirmed_at,'nextStep','execute','businessDataWritten',false);
  END IF;

  IF v_cmd.status <> 'confirmed' OR v_cmd.confirmed_by_uid <> p_actor_uid OR
     p_preview_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Human confirmation required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id = v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_cmd.person_updated_at THEN
    RAISE EXCEPTION 'Person changed since preview' USING ERRCODE = '40001';
  END IF;
  IF v_cmd.operation = 'create' THEN
    v_due := NULLIF(v_cmd.draft->>'due_at','')::timestamptz;
    IF EXISTS (SELECT 1 FROM public.actions a WHERE a.person_id = v_cmd.person_id
      AND a.status IN ('open','in_progress')
      AND lower(btrim(a.title)) = lower(btrim(v_cmd.draft->>'title'))
      AND a.due_at IS NOT DISTINCT FROM v_due) THEN
      RAISE EXCEPTION 'Matching Action already exists' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.actions(person_id,action_type,title,description,due_at,priority,
      status,source,created_by_uid,confirmed_by_uid,confirmed_at)
      VALUES (v_cmd.person_id,v_cmd.draft->>'action_type',v_cmd.draft->>'title',
        v_cmd.draft->>'description',v_due,v_cmd.draft->>'priority',
        'open','ai_assistant',p_actor_uid,p_actor_uid,v_cmd.confirmed_at)
      RETURNING id INTO v_action_id;
    UPDATE public.assistant_action_commands SET status='executed',
      executed_action_id=v_action_id, updated_at=now() WHERE id=v_cmd.id;
  ELSE
    SELECT * INTO v_action FROM public.actions a
      WHERE a.id=v_cmd.target_action_id AND a.person_id=v_cmd.person_id
        AND a.status IN ('open','in_progress') FOR UPDATE;
    IF NOT FOUND OR v_action.updated_at IS DISTINCT FROM v_cmd.action_updated_at THEN
      RAISE EXCEPTION 'Action changed since preview' USING ERRCODE = '40001';
    END IF;
    IF v_cmd.operation = 'update' THEN
      UPDATE public.actions SET
        action_type=CASE WHEN v_cmd.draft ? 'action_type' THEN v_cmd.draft->>'action_type' ELSE action_type END,
        title=CASE WHEN v_cmd.draft ? 'title' THEN v_cmd.draft->>'title' ELSE title END,
        description=CASE WHEN v_cmd.draft ? 'description' THEN v_cmd.draft->>'description' ELSE description END,
        due_at=CASE WHEN v_cmd.draft ? 'due_at' THEN NULLIF(v_cmd.draft->>'due_at','')::timestamptz ELSE due_at END,
        priority=CASE WHEN v_cmd.draft ? 'priority' THEN v_cmd.draft->>'priority' ELSE priority END,
        updated_at=clock_timestamp()
        WHERE id=v_cmd.target_action_id AND person_id=v_cmd.person_id
          AND status IN ('open','in_progress');
    ELSE
      UPDATE public.actions SET status='completed', completed_at=clock_timestamp(),
        completed_by_uid=p_actor_uid, updated_at=clock_timestamp()
        WHERE id=v_cmd.target_action_id AND person_id=v_cmd.person_id
          AND status IN ('open','in_progress');
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Action changed during execution' USING ERRCODE = '40001'; END IF;
    v_action_id := v_cmd.target_action_id;
    UPDATE public.assistant_action_commands SET status='executed', updated_at=now()
      WHERE id=v_cmd.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
    'actionId',v_action_id,'replayed',false,'businessDataWritten',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text) TO service_role;
COMMIT;
