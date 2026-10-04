-- WP12 review decisions: service-only, expiring previews and atomic replay-safe execution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
  IF to_regclass('public.crm_activity_review_commands') IS NOT NULL THEN
    RAISE EXCEPTION 'WP12 command ledger already exists';
  END IF;
END $guard$;

CREATE TABLE public.crm_activity_review_commands (
  id uuid PRIMARY KEY,
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{32}$'),
  operation text NOT NULL CHECK (operation IN
    ('action','opportunity','reject_action','reject_opportunity','outcome')),
  activity_id bigint NOT NULL REFERENCES public.activities(id),
  ai_result_id bigint REFERENCES public.ai_results(id),
  candidate_index integer,
  person_id bigint REFERENCES public.persons(id),
  candidate_json jsonb,
  payload jsonb NOT NULL,
  source_hash text,
  activity_updated_at timestamptz NOT NULL,
  person_updated_at timestamptz,
  expires_at timestamptz NOT NULL,
  executed_at timestamptz,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation='outcome' AND ai_result_id IS NULL AND candidate_index IS NULL
    AND person_id IS NULL) OR (operation<>'outcome' AND ai_result_id IS NOT NULL
    AND candidate_index BETWEEN 0 AND 11 AND person_id IS NOT NULL))
);
CREATE INDEX crm_activity_review_commands_activity_idx
  ON public.crm_activity_review_commands(activity_id,created_at DESC);
CREATE UNIQUE INDEX crm_activity_review_source_once_idx
  ON public.crm_activity_review_commands(activity_id,operation,person_id,source_hash)
  WHERE executed_at IS NOT NULL AND operation IN ('action','opportunity');
CREATE UNIQUE INDEX crm_activity_review_item_decision_once_idx
  ON public.crm_activity_review_commands(ai_result_id,
    (CASE WHEN operation IN ('action','reject_action') THEN 'action' ELSE 'opportunity' END),
    candidate_index)
  WHERE executed_at IS NOT NULL AND operation IN
    ('action','opportunity','reject_action','reject_opportunity');

ALTER TABLE public.crm_activity_review_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity_review_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_activity_review_commands_service_only
  ON public.crm_activity_review_commands TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_activity_review_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_activity_review_commands TO service_role;

-- Reserve each substantive source independently. A later AI result cannot
-- duplicate the same event by appending another source to its candidate.
CREATE TABLE public.crm_activity_review_source_claims (
  command_id uuid NOT NULL REFERENCES public.crm_activity_review_commands(id),
  activity_id bigint NOT NULL REFERENCES public.activities(id),
  operation text NOT NULL CHECK (operation IN ('action','opportunity')),
  person_id bigint NOT NULL REFERENCES public.persons(id),
  source_ref text NOT NULL CHECK (source_ref ~ '^public\.(interactions|activity_participants)#[1-9][0-9]*$'),
  PRIMARY KEY (activity_id,operation,person_id,source_ref)
);
ALTER TABLE public.crm_activity_review_source_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity_review_source_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_activity_review_source_claims_service_only
  ON public.crm_activity_review_source_claims TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_activity_review_source_claims FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT ON public.crm_activity_review_source_claims TO service_role;

CREATE FUNCTION public.crm_activity_review_preview_v1(
  p_actor_uid text,p_idempotency_key uuid,p_operation text,p_activity_id bigint,
  p_ai_result_id bigint,p_candidate_index integer,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $preview$
DECLARE
  v_activity public.activities%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_task public.ai_tasks%ROWTYPE;
  v_result public.ai_results%ROWTYPE;
  v_command public.crm_activity_review_commands%ROWTYPE;
  v_candidate jsonb;
  v_refs jsonb;
  v_ref text;
  v_kind text;
  v_source_hash text;
  v_request_hash text;
  v_test boolean;
  v_payload jsonb;
  v_person_id bigint;
  v_due timestamptz;
  v_occurred timestamptz;
BEGIN
  IF nullif(btrim(p_actor_uid),'') IS NULL OR p_idempotency_key IS NULL OR
     p_operation NOT IN ('action','opportunity','reject_action','reject_opportunity','outcome') OR
     p_activity_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid activity preview' USING ERRCODE='22023';
  END IF;
  v_request_hash := md5(p_actor_uid || p_operation || p_activity_id::text ||
    coalesce(p_ai_result_id::text,'') || coalesce(p_candidate_index::text,'') || p_payload::text);
  SELECT * INTO v_command FROM public.crm_activity_review_commands
    WHERE id=p_idempotency_key;
  IF FOUND THEN
    IF v_command.actor_uid<>p_actor_uid OR v_command.request_hash<>v_request_hash THEN
      RAISE EXCEPTION 'Idempotency key belongs to another activity request' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('previewId',v_command.id,'operation',v_command.operation,
      'activityId',v_command.activity_id,'personId',v_command.person_id,
      'after',v_command.payload,'sourceRefs',v_command.candidate_json->'sourceRefs',
      'expiresAt',v_command.expires_at,'replayed',true,
      'businessDataWritten',false);
  END IF;
  SELECT * INTO v_activity FROM public.activities WHERE id=p_activity_id
    AND deleted_at IS NULL;
  IF NOT FOUND OR v_activity.status NOT IN ('ended','reviewed') THEN
    RAISE EXCEPTION 'Activity must be ended and active' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.crm_test_batches
    WHERE created_by_uid=p_actor_uid) INTO v_test;
  IF v_test AND NOT EXISTS(SELECT 1 FROM public.crm_test_records r
    JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
    WHERE b.created_by_uid=p_actor_uid AND r.record_table='activities'
      AND r.record_id=p_activity_id::text) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Activity' USING ERRCODE='42501';
  END IF;
  IF p_operation='outcome' THEN
    IF p_ai_result_id IS NOT NULL OR p_candidate_index IS NOT NULL OR
       (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3 OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
         WHERE k NOT IN ('outcomeType','result','occurredAt')) OR
       length(btrim(p_payload->>'outcomeType')) NOT BETWEEN 1 AND 64 OR
       length(btrim(p_payload->>'result')) NOT BETWEEN 1 AND 4000 OR
       (p_payload->>'occurredAt') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
      RAISE EXCEPTION 'Invalid activity Outcome' USING ERRCODE='22023';
    END IF;
    BEGIN v_occurred := (p_payload->>'occurredAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid Outcome time' USING ERRCODE='22023'; END;
    IF v_occurred > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'Outcome must describe an observed result' USING ERRCODE='22023';
    END IF;
    v_payload := jsonb_build_object('outcomeType',btrim(p_payload->>'outcomeType'),
      'result',btrim(p_payload->>'result'),'occurredAt',v_occurred);
    IF v_test AND position('【系统测试·勿联系】' IN v_payload->>'result')=0 THEN
      v_payload := jsonb_set(v_payload,'{result}',to_jsonb(
        '【系统测试·勿联系】' || left(v_payload->>'result',3978)));
    END IF;
  ELSE
    IF p_ai_result_id IS NULL OR p_candidate_index IS NULL OR
       p_candidate_index NOT BETWEEN 0 AND 11 THEN
      RAISE EXCEPTION 'Invalid activity candidate reference' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_result FROM public.ai_results WHERE id=p_ai_result_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Activity candidate source unavailable' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_task FROM public.ai_tasks WHERE id=v_result.task_id;
    IF NOT FOUND OR v_task.skill_name<>'activity_review' OR
       v_task.subject_type<>'activity' OR v_task.subject_id<>p_activity_id::text OR
       v_task.status<>'completed' THEN
      RAISE EXCEPTION 'Activity candidate source unavailable' USING ERRCODE='22023';
    END IF;
    v_kind := CASE WHEN p_operation IN ('action','reject_action')
      THEN 'actionCandidates' ELSE 'opportunityCandidates' END;
    v_candidate := v_result.result_json->v_kind->p_candidate_index;
    IF jsonb_typeof(v_candidate) IS DISTINCT FROM 'object' OR
       (v_candidate->>'personId') !~ '^[1-9][0-9]*$' OR
       jsonb_typeof(v_candidate->'sourceRefs') IS DISTINCT FROM 'array' OR
       jsonb_array_length(v_candidate->'sourceRefs') NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION 'Invalid activity candidate' USING ERRCODE='22023';
    END IF;
    v_person_id := (v_candidate->>'personId')::bigint;
    SELECT * INTO v_person FROM public.persons WHERE id=v_person_id
      AND deleted_at IS NULL;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM
      jsonb_array_elements(coalesce(v_task.context_snapshot->'persons','[]'::jsonb)) x
      WHERE x->'data'->>'id'=v_person_id::text) THEN
      RAISE EXCEPTION 'Activity candidate Person changed' USING ERRCODE='40001';
    END IF;
    IF v_test AND NOT EXISTS(SELECT 1 FROM public.crm_test_records r
      JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
      WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons'
        AND r.record_id=v_person_id::text) THEN
      RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
    END IF;
    v_refs := v_candidate->'sourceRefs';
    FOR v_ref IN SELECT jsonb_array_elements_text(v_refs) LOOP
      IF v_ref !~ '^public\.[a-z_]+#[1-9][0-9]*$' OR NOT EXISTS(
        SELECT 1 FROM jsonb_path_query(v_task.context_snapshot,'$.**.source') s
        WHERE s->>'schema'='public' AND v_ref=
          'public.' || (s->>'table') || '#' || (s->>'id')) THEN
        RAISE EXCEPTION 'Activity candidate has unsupported source' USING ERRCODE='22023';
      END IF;
    END LOOP;
    IF p_operation='opportunity' AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(v_refs) ref
      JOIN public.interactions i ON ref.value='public.interactions#' || i.id::text
      WHERE i.activity_id=p_activity_id AND i.person_id=v_person_id AND i.importance>=3) THEN
      RAISE EXCEPTION 'Opportunity needs a substantive activity interaction' USING ERRCODE='22023';
    END IF;
    IF p_operation='action' AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(v_refs) ref
      WHERE EXISTS(SELECT 1 FROM public.interactions i
        WHERE ref.value='public.interactions#' || i.id::text AND
          i.activity_id=p_activity_id AND i.person_id=v_person_id AND i.importance>=3)
        OR EXISTS(SELECT 1 FROM public.activity_participants ap
          WHERE ref.value='public.activity_participants#' || ap.id::text AND
            ap.activity_id=p_activity_id AND ap.canonical_person_id=v_person_id AND
            ap.status='attended' AND ap.deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Action needs attendance or a substantive interaction' USING ERRCODE='22023';
    END IF;
    IF p_operation IN ('action','opportunity') AND EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(v_refs) ref
      JOIN public.crm_activity_review_source_claims claim
        ON claim.activity_id=p_activity_id AND claim.operation=p_operation
        AND claim.person_id=v_person_id AND claim.source_ref=ref.value) THEN
      RAISE EXCEPTION 'Activity source already accepted' USING ERRCODE='23505';
    END IF;
    SELECT md5(v_kind || v_person_id::text || string_agg(ref.value,',' ORDER BY ref.value))
      INTO v_source_hash FROM jsonb_array_elements_text(v_refs) ref;
    IF p_operation IN ('action','opportunity') AND EXISTS(
      SELECT 1 FROM public.crm_activity_review_commands c
      WHERE c.activity_id=p_activity_id AND c.operation=p_operation AND
        c.person_id=v_person_id AND c.source_hash=v_source_hash AND
        c.executed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Activity source already accepted' USING ERRCODE='23505';
    END IF;
    IF p_operation LIKE 'reject_%' THEN
      IF p_payload<>'{}'::jsonb THEN
        RAISE EXCEPTION 'Invalid candidate rejection payload' USING ERRCODE='22023';
      END IF;
      v_payload := '{}'::jsonb;
    ELSIF p_operation='action' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>4 OR
         EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
           WHERE k NOT IN ('title','description','dueAt','priority')) OR
         length(btrim(p_payload->>'title')) NOT BETWEEN 1 AND 200 OR
         length(coalesce(p_payload->>'description',''))>4000 OR
         p_payload->>'priority' NOT IN ('low','medium','high','urgent') THEN
        RAISE EXCEPTION 'Invalid Action candidate draft' USING ERRCODE='22023';
      END IF;
      IF p_payload->>'dueAt' IS NOT NULL AND p_payload->>'dueAt'<>'' THEN
        BEGIN v_due := (p_payload->>'dueAt')::timestamptz;
        EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid Action due date' USING ERRCODE='22023'; END;
      END IF;
      v_payload := jsonb_build_object('title',btrim(p_payload->>'title'),
        'description',nullif(btrim(p_payload->>'description'),''),
        'priority',p_payload->>'priority','dueAt',v_due);
      IF v_test AND position('【系统测试·勿联系】' IN v_payload->>'title')=0 THEN
        v_payload := jsonb_set(v_payload,'{title}',to_jsonb(
          '【系统测试·勿联系】' || left(v_payload->>'title',178)));
      END IF;
    ELSE
      IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3 OR
         EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
           WHERE k NOT IN ('type','reason','nextAction')) OR
         p_payload->>'type' NOT IN
           ('insurance','recruit','referral','activity','speaker','partnership','service','relationship') OR
         p_payload->>'type'<>v_candidate->>'opportunityType' OR
         length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 1000 OR
         length(btrim(p_payload->>'nextAction')) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid Opportunity candidate draft' USING ERRCODE='22023';
      END IF;
      v_payload := jsonb_build_object('type',p_payload->>'type',
        'reason',btrim(p_payload->>'reason'),'nextAction',btrim(p_payload->>'nextAction'));
      IF v_test THEN
        IF position('【系统测试·勿联系】' IN v_payload->>'reason')=0 THEN
          v_payload := jsonb_set(v_payload,'{reason}',to_jsonb(
            '【系统测试·勿联系】' || left(v_payload->>'reason',978)));
        END IF;
        IF position('【系统测试·勿联系】' IN v_payload->>'nextAction')=0 THEN
          v_payload := jsonb_set(v_payload,'{nextAction}',to_jsonb(
            '【系统测试·勿联系】' || left(v_payload->>'nextAction',478)));
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.crm_activity_review_commands
    (id,actor_uid,request_hash,operation,activity_id,ai_result_id,candidate_index,
      person_id,candidate_json,payload,source_hash,activity_updated_at,
      person_updated_at,expires_at)
    VALUES (p_idempotency_key,p_actor_uid,v_request_hash,p_operation,p_activity_id,
      p_ai_result_id,p_candidate_index,v_person_id,v_candidate,v_payload,v_source_hash,
      v_activity.updated_at,v_person.updated_at,clock_timestamp()+interval '15 minutes')
    RETURNING * INTO v_command;
  RETURN jsonb_build_object('previewId',v_command.id,'operation',v_command.operation,
    'activityId',v_command.activity_id,'personId',v_command.person_id,
    'after',v_command.payload,'sourceRefs',v_refs,'expiresAt',v_command.expires_at,
    'replayed',false,'businessDataWritten',false);
END $preview$;

CREATE FUNCTION public.crm_activity_review_execute_v1(
  p_actor_uid text,p_preview_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $execute$
DECLARE
  v_command public.crm_activity_review_commands%ROWTYPE;
  v_activity public.activities%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_id bigint;
  v_result jsonb;
BEGIN
  IF nullif(btrim(p_actor_uid),'') IS NULL OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid activity execution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_command FROM public.crm_activity_review_commands
    WHERE id=p_preview_id FOR UPDATE;
  IF NOT FOUND OR v_command.actor_uid<>p_actor_uid THEN
    RAISE EXCEPTION 'Activity preview unavailable' USING ERRCODE='42501';
  END IF;
  IF v_command.executed_at IS NOT NULL THEN
    RETURN v_command.result_json || jsonb_build_object('replayed',true,
      'businessDataWritten',false);
  END IF;
  IF v_command.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Activity preview expired' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_activity FROM public.activities WHERE id=v_command.activity_id
    AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_activity.updated_at IS DISTINCT FROM v_command.activity_updated_at OR
     v_activity.status NOT IN ('ended','reviewed') THEN
    RAISE EXCEPTION 'Activity changed since preview' USING ERRCODE='40001';
  END IF;
  IF v_command.person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.persons WHERE id=v_command.person_id
      AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_command.person_updated_at THEN
      RAISE EXCEPTION 'Activity Person changed since preview' USING ERRCODE='40001';
    END IF;
  END IF;
  IF v_command.operation IN ('action','opportunity') AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(v_command.candidate_json->'sourceRefs') ref
    WHERE EXISTS(SELECT 1 FROM public.interactions i
      WHERE ref.value='public.interactions#' || i.id::text AND
        i.activity_id=v_command.activity_id AND i.person_id=v_command.person_id AND
        i.importance>=3)
      OR (v_command.operation='action' AND EXISTS(
        SELECT 1 FROM public.activity_participants ap
        WHERE ref.value='public.activity_participants#' || ap.id::text AND
          ap.activity_id=v_command.activity_id AND
          ap.canonical_person_id=v_command.person_id AND ap.status='attended'
          AND ap.deleted_at IS NULL))) THEN
    RAISE EXCEPTION 'Activity candidate evidence changed' USING ERRCODE='40001';
  END IF;
  IF v_command.operation='action' THEN
    IF EXISTS(SELECT 1 FROM public.crm_activity_review_commands c
      WHERE c.activity_id=v_command.activity_id AND c.operation='action' AND
        c.person_id=v_command.person_id AND c.source_hash=v_command.source_hash AND
        c.executed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Activity source already accepted' USING ERRCODE='23505';
    END IF;
    INSERT INTO public.actions(person_id,activity_id,action_type,title,description,
      due_at,priority,status,source,created_by_uid,confirmed_by_uid,confirmed_at)
    VALUES(v_command.person_id,v_command.activity_id,'followup',
      v_command.payload->>'title',v_command.payload->>'description',
      (v_command.payload->>'dueAt')::timestamptz,
      v_command.payload->>'priority','open','ai_activity_review',
      p_actor_uid,p_actor_uid,clock_timestamp()) RETURNING id INTO v_id;
    v_result := jsonb_build_object('status','accepted','kind','action','actionId',v_id,
      'personId',v_command.person_id,'activityId',v_command.activity_id,
      'businessDataWritten',true);
  ELSIF v_command.operation='opportunity' THEN
    IF EXISTS(SELECT 1 FROM public.crm_activity_review_commands c
      WHERE c.activity_id=v_command.activity_id AND c.operation='opportunity' AND
        c.person_id=v_command.person_id AND c.source_hash=v_command.source_hash AND
        c.executed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Activity source already accepted' USING ERRCODE='23505';
    END IF;
    INSERT INTO public.opportunity_candidates(person_id,ai_result_id,created_by_uid,
      draft,evidence)
    VALUES(v_command.person_id,v_command.ai_result_id,p_actor_uid,
      jsonb_build_object('opportunity_type',v_command.payload->>'type',
        'reason',v_command.payload->>'reason',
        'next_action',v_command.payload->>'nextAction'),
      v_command.candidate_json->'sourceRefs') RETURNING id INTO v_id;
    v_result := jsonb_build_object('status','accepted','kind','opportunity',
      'candidateId',v_id,'personId',v_command.person_id,
      'activityId',v_command.activity_id,'businessDataWritten',true);
  ELSIF v_command.operation='outcome' THEN
    INSERT INTO public.outcomes(activity_id,outcome_type,result,occurred_at)
    VALUES(v_command.activity_id,v_command.payload->>'outcomeType',
      v_command.payload->>'result',(v_command.payload->>'occurredAt')::timestamptz)
      RETURNING id INTO v_id;
    v_result := jsonb_build_object('status','recorded','kind','outcome',
      'outcomeId',v_id,'activityId',v_command.activity_id,'businessDataWritten',true);
  ELSE
    v_result := jsonb_build_object('status','rejected',
      'kind',CASE WHEN v_command.operation='reject_action' THEN 'action'
        ELSE 'opportunity' END,'activityId',v_command.activity_id,
      'businessDataWritten',false);
  END IF;
  UPDATE public.crm_activity_review_commands SET executed_at=clock_timestamp(),
    result_json=v_result WHERE id=v_command.id;
  IF v_command.operation IN ('action','opportunity') THEN
    INSERT INTO public.crm_activity_review_source_claims
      (command_id,activity_id,operation,person_id,source_ref)
    SELECT v_command.id,v_command.activity_id,v_command.operation,
      v_command.person_id,ref.value
    FROM jsonb_array_elements_text(v_command.candidate_json->'sourceRefs') ref
    WHERE EXISTS(SELECT 1 FROM public.interactions i
      WHERE ref.value='public.interactions#' || i.id::text AND
        i.activity_id=v_command.activity_id AND i.person_id=v_command.person_id
        AND i.importance>=3)
      OR (v_command.operation='action' AND EXISTS(
        SELECT 1 FROM public.activity_participants ap
        WHERE ref.value='public.activity_participants#' || ap.id::text AND
          ap.activity_id=v_command.activity_id AND
          ap.canonical_person_id=v_command.person_id AND ap.status='attended'
          AND ap.deleted_at IS NULL));
  END IF;
  RETURN v_result || jsonb_build_object('replayed',false);
END $execute$;

REVOKE ALL ON FUNCTION public.crm_activity_review_preview_v1(text,uuid,text,bigint,bigint,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_activity_review_execute_v1(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_activity_review_preview_v1(text,uuid,text,bigint,bigint,integer,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_activity_review_execute_v1(text,uuid)
  TO service_role;
COMMIT;
