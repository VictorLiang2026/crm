-- First executable Assistant command: confirmed, Person-scoped Action creation only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.assistant_action_commands') IS NOT NULL OR
     to_regprocedure('public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Assistant Action command objects already exist';
  END IF;
END $guard$;

CREATE TABLE public.assistant_action_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  draft jsonb NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'previewed', 'confirmed', 'executed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  preview_json jsonb,
  preview_hash text,
  person_updated_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed_by_uid text,
  confirmed_at timestamptz,
  executed_action_id bigint UNIQUE REFERENCES public.actions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_action_confirmation_check CHECK (
    (status IN ('planned', 'previewed') AND confirmed_by_uid IS NULL AND confirmed_at IS NULL
      AND executed_action_id IS NULL)
    OR (status = 'confirmed' AND confirmed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL
      AND executed_action_id IS NULL)
    OR (status = 'executed' AND confirmed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL
      AND executed_action_id IS NOT NULL)
  )
);
CREATE INDEX assistant_action_commands_actor_idx
  ON public.assistant_action_commands(actor_uid, created_at DESC);
CREATE INDEX assistant_action_commands_expiry_idx
  ON public.assistant_action_commands(expires_at) WHERE status <> 'executed';
ALTER TABLE public.assistant_action_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_action_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_action_commands_service_only
  ON public.assistant_action_commands FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.assistant_action_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.assistant_action_commands TO service_role;

CREATE FUNCTION public.assistant_action_command_v1(
  p_stage text, p_actor_uid text, p_command_id uuid DEFAULT NULL,
  p_person_id bigint DEFAULT NULL, p_draft jsonb DEFAULT NULL,
  p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_cmd public.assistant_action_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_draft jsonb;
  v_preview jsonb;
  v_hash text;
  v_due timestamptz;
  v_action_id bigint;
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
       jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR
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
    SELECT * INTO v_person FROM public.persons
      WHERE id = p_person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = '23503'; END IF;
    v_draft := jsonb_build_object(
      'action_type', btrim(p_draft->>'action_type'), 'title', btrim(p_draft->>'title'),
      'description', CASE WHEN p_draft ? 'description' THEN p_draft->'description' ELSE 'null'::jsonb END,
      'due_at', to_jsonb(v_due), 'priority', COALESCE(p_draft->>'priority','medium'));
    INSERT INTO public.assistant_action_commands(actor_uid, person_id, draft)
      VALUES (p_actor_uid, p_person_id, v_draft) RETURNING * INTO v_cmd;
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
      'actionId',v_cmd.executed_action_id,'replayed',true,'businessDataWritten',false);
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
      v_cmd.draft::text || COALESCE(v_person.updated_at::text,'') ||
      (v_cmd.version + 1)::text);
    UPDATE public.assistant_action_commands SET status='previewed',
      preview_json=v_preview, preview_hash=v_hash,
      person_updated_at=v_person.updated_at, version=version+1, updated_at=now()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
      'version',v_cmd.version,'preview',v_preview,'previewHash',v_hash,
      'expiresAt',v_cmd.expires_at,'nextStep','confirm','businessDataWritten',false);
  END IF;

  IF p_stage = 'confirm' THEN
    IF v_cmd.status <> 'previewed' OR p_preview_hash IS NULL OR
       p_preview_hash <> v_cmd.preview_hash OR
       length(p_preview_hash) <> 32 THEN
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
  RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
    'actionId',v_action_id,'replayed',false,'businessDataWritten',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text)
  TO service_role;
COMMENT ON FUNCTION public.assistant_action_command_v1(text,text,uuid,bigint,jsonb,text) IS
  'Authenticated, preview-bound, once-only Assistant Action creation; only service_role may invoke.';
COMMIT;
