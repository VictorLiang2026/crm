-- PC29: append-only AI feedback, linked human Outcomes, and reviewed Learning metadata.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.ai_result_feedback_events') IS NOT NULL OR
     to_regprocedure('public.crm_ai_experience_decide_v1(text,uuid,bigint,text,text,jsonb)') IS NOT NULL OR
     to_regprocedure('public.crm_ai_experience_outcome_v1(text,uuid,text,bigint,bigint,text,timestamp with time zone,text)') IS NOT NULL OR
     to_regprocedure('public.crm_ai_experience_learning_v1(text,uuid,jsonb)') IS NOT NULL OR
     to_regprocedure('public.crm_ai_experience_confirm_learning_v1(text,bigint,text)') IS NOT NULL OR
     EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='outcomes'
         AND column_name IN ('recruit_followup_id','evidence','recorded_by_uid','idempotency_key')) OR
     EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='learnings'
         AND column_name IN ('sample_size','counterexamples','provenance','candidate_key')) THEN
    RAISE EXCEPTION 'PC29 objects already exist; inspect before migrating';
  END IF;
END
$guard$;

CREATE TABLE public.ai_result_feedback_events (
  id uuid PRIMARY KEY,
  ai_result_id bigint NOT NULL REFERENCES public.ai_results(id) ON DELETE RESTRICT,
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  decision text NOT NULL CHECK (decision IN ('pending','accepted','modified','rejected')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 2000),
  edit_delta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_result_feedback_rejection_reason_check CHECK (decision <> 'rejected' OR reason IS NOT NULL),
  CONSTRAINT ai_result_feedback_modified_delta_check CHECK (
    (decision = 'modified' AND jsonb_typeof(edit_delta) = 'object' AND edit_delta <> '{}'::jsonb)
    OR (decision <> 'modified' AND edit_delta IS NULL)
  )
);
CREATE INDEX ai_result_feedback_latest_idx
  ON public.ai_result_feedback_events(ai_result_id, created_at DESC, id DESC);
ALTER TABLE public.ai_result_feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_result_feedback_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_result_feedback_events_service_only ON public.ai_result_feedback_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ai_result_feedback_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ai_result_feedback_events TO service_role;

ALTER TABLE public.outcomes
  ADD COLUMN recruit_followup_id bigint REFERENCES public.recruit_followups(id) ON DELETE SET NULL,
  ADD COLUMN evidence text CHECK (evidence IS NULL OR length(btrim(evidence)) BETWEEN 1 AND 8000),
  ADD COLUMN recorded_by_uid text CHECK (recorded_by_uid IS NULL OR length(btrim(recorded_by_uid)) BETWEEN 1 AND 128),
  ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX outcomes_idempotency_key_uidx ON public.outcomes(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX outcomes_recruit_followup_idx ON public.outcomes(recruit_followup_id, occurred_at DESC)
  WHERE recruit_followup_id IS NOT NULL;

ALTER TABLE public.learnings
  ADD COLUMN sample_size integer CHECK (sample_size IS NULL OR sample_size >= 0),
  ADD COLUMN counterexamples jsonb CHECK (counterexamples IS NULL OR jsonb_typeof(counterexamples) = 'array'),
  ADD COLUMN provenance jsonb CHECK (provenance IS NULL OR jsonb_typeof(provenance) = 'object'),
  ADD COLUMN candidate_key uuid;
CREATE UNIQUE INDEX learnings_candidate_key_uidx ON public.learnings(candidate_key)
  WHERE candidate_key IS NOT NULL;

CREATE FUNCTION public.crm_ai_experience_decide_v1(
  p_actor_uid text, p_event_id uuid, p_ai_result_id bigint,
  p_decision text, p_reason text, p_edit_delta jsonb
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
DECLARE v_event public.ai_result_feedback_events%ROWTYPE;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_event_id IS NULL OR p_ai_result_id IS NULL OR
     p_decision NOT IN ('pending','accepted','modified','rejected') OR
     (p_reason IS NOT NULL AND length(btrim(p_reason)) NOT BETWEEN 1 AND 2000) OR
     (p_decision='rejected' AND p_reason IS NULL) OR
     (p_decision='modified' AND (jsonb_typeof(p_edit_delta) IS DISTINCT FROM 'object' OR p_edit_delta='{}'::jsonb)) OR
     (p_decision<>'modified' AND p_edit_delta IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid AI feedback decision' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.ai_results r JOIN public.ai_tasks t ON t.id=r.task_id
    WHERE r.id=p_ai_result_id AND t.status='completed' FOR SHARE OF r,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI result is unavailable' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_event FROM public.ai_result_feedback_events WHERE id=p_event_id;
  IF FOUND THEN
    IF (v_event.actor_uid,v_event.ai_result_id,v_event.decision,v_event.reason,v_event.edit_delta)
       IS DISTINCT FROM (p_actor_uid,p_ai_result_id,p_decision,NULLIF(btrim(p_reason),''),p_edit_delta) THEN
      RAISE EXCEPTION 'Idempotency key was reused with different input' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('ok',true,'eventId',v_event.id,'decision',v_event.decision,'replayed',true);
  END IF;
  INSERT INTO public.ai_result_feedback_events(id,ai_result_id,actor_uid,decision,reason,edit_delta)
    VALUES(p_event_id,p_ai_result_id,p_actor_uid,p_decision,NULLIF(btrim(p_reason),''),p_edit_delta)
    RETURNING * INTO v_event;
  RETURN jsonb_build_object('ok',true,'eventId',v_event.id,'decision',v_event.decision,'replayed',false);
END;
$function$;

CREATE FUNCTION public.crm_ai_experience_outcome_v1(
  p_actor_uid text, p_idempotency_key uuid, p_target_type text, p_target_id bigint,
  p_ai_result_id bigint, p_result text, p_occurred_at timestamptz, p_evidence text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
DECLARE v_outcome public.outcomes%ROWTYPE; v_candidate_id bigint;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_idempotency_key IS NULL OR p_target_id IS NULL OR
     p_target_type NOT IN ('action','opportunity','activity','recruit_followup') OR
     p_result IS NULL OR length(btrim(p_result)) NOT BETWEEN 1 AND 4000 OR
     p_occurred_at IS NULL OR p_occurred_at > now()+interval '1 day' OR
     p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'Invalid actual Outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_outcome FROM public.outcomes WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF (v_outcome.recorded_by_uid,v_outcome.action_id,v_outcome.opportunity_id,v_outcome.activity_id,
        v_outcome.recruit_followup_id,v_outcome.ai_result_id,v_outcome.result,v_outcome.occurred_at,v_outcome.evidence)
       IS DISTINCT FROM
       (p_actor_uid,CASE WHEN p_target_type='action' THEN p_target_id END,
        CASE WHEN p_target_type='opportunity' THEN p_target_id END,
        CASE WHEN p_target_type='activity' THEN p_target_id END,
        CASE WHEN p_target_type='recruit_followup' THEN p_target_id END,
        p_ai_result_id,btrim(p_result),p_occurred_at,btrim(p_evidence)) THEN
      RAISE EXCEPTION 'Idempotency key was reused with different input' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('ok',true,'outcomeId',v_outcome.id,'replayed',true);
  END IF;
  IF p_target_type='action' THEN
    PERFORM 1 FROM public.actions WHERE id=p_target_id AND status='completed' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Action must be completed and available' USING ERRCODE='23503'; END IF;
  ELSIF p_target_type='opportunity' THEN
    PERFORM 1 FROM public.opportunities WHERE id=p_target_id AND deleted_at IS NULL AND status IN ('成交','关闭') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity must be closed and available' USING ERRCODE='23503'; END IF;
  ELSIF p_target_type='activity' THEN
    PERFORM 1 FROM public.activities WHERE id=p_target_id AND deleted_at IS NULL AND status IN ('ended','reviewed') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Activity must be ended and available' USING ERRCODE='23503'; END IF;
  ELSE
    SELECT candidate_id INTO v_candidate_id FROM public.recruit_followups
      WHERE id=p_target_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recruit follow-up is unavailable' USING ERRCODE='23503'; END IF;
    PERFORM 1 FROM public.recruit_candidates WHERE id=v_candidate_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recruit candidate is unavailable' USING ERRCODE='23503'; END IF;
  END IF;
  IF p_ai_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_results r JOIN public.ai_tasks t ON t.id=r.task_id
    WHERE r.id=p_ai_result_id AND t.status='completed'
  ) THEN RAISE EXCEPTION 'AI result is unavailable' USING ERRCODE='23503'; END IF;
  INSERT INTO public.outcomes(action_id,opportunity_id,activity_id,recruit_candidate_id,recruit_followup_id,
      ai_result_id,outcome_type,result,occurred_at,evidence,recorded_by_uid,idempotency_key)
  VALUES(CASE WHEN p_target_type='action' THEN p_target_id END,
      CASE WHEN p_target_type='opportunity' THEN p_target_id END,
      CASE WHEN p_target_type='activity' THEN p_target_id END,
      v_candidate_id,CASE WHEN p_target_type='recruit_followup' THEN p_target_id END,
      p_ai_result_id,'actual_result',btrim(p_result),p_occurred_at,btrim(p_evidence),p_actor_uid,p_idempotency_key)
  RETURNING * INTO v_outcome;
  RETURN jsonb_build_object('ok',true,'outcomeId',v_outcome.id,'replayed',false);
END;
$function$;

CREATE FUNCTION public.crm_ai_experience_learning_v1(p_actor_uid text,p_candidate_key uuid,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
DECLARE v_learning public.learnings%ROWTYPE; v_result_ids bigint[]; v_primary bigint;
  v_sample integer; v_counterexamples jsonb; v_provenance jsonb; v_sources jsonb;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_candidate_key IS NULL OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(p_payload)) NOT BETWEEN 5 AND 9 OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
       ('sourceResultIds','primaryResultId','situation','recommendation','actualAction','learning','scope','confidence','counterexampleIds')) OR
     jsonb_typeof(p_payload->'sourceResultIds') IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_payload->'sourceResultIds') NOT BETWEEN 1 AND 100 OR
     jsonb_typeof(p_payload->'primaryResultId') IS DISTINCT FROM 'number' OR
     length(btrim(COALESCE(p_payload->>'situation',''))) NOT BETWEEN 1 AND 2000 OR
     length(btrim(COALESCE(p_payload->>'learning',''))) NOT BETWEEN 1 AND 4000 OR
     length(btrim(COALESCE(p_payload->>'scope',''))) NOT BETWEEN 1 AND 128 OR
     (p_payload ? 'recommendation' AND length(p_payload->>'recommendation')>4000) OR
     (p_payload ? 'actualAction' AND length(p_payload->>'actualAction')>4000) OR
     (p_payload ? 'confidence' AND (jsonb_typeof(p_payload->'confidence')<>'number' OR (p_payload->>'confidence')::numeric NOT BETWEEN 0 AND 1)) OR
     (p_payload ? 'counterexampleIds' AND jsonb_typeof(p_payload->'counterexampleIds')<>'array') THEN
    RAISE EXCEPTION 'Invalid Learning candidate' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_learning FROM public.learnings WHERE candidate_key=p_candidate_key;
  IF FOUND THEN
    IF v_learning.source_id IS DISTINCT FROM (p_payload->>'primaryResultId')::bigint OR
       v_learning.learning IS DISTINCT FROM btrim(p_payload->>'learning') OR
       v_learning.scope IS DISTINCT FROM btrim(p_payload->>'scope') THEN
      RAISE EXCEPTION 'Candidate key was reused with different input' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'sampleSize',v_learning.sample_size,'replayed',true);
  END IF;
  SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) INTO v_result_ids
    FROM jsonb_array_elements_text(p_payload->'sourceResultIds') e(value)
    WHERE value ~ '^[1-9][0-9]{0,18}$';
  IF COALESCE(cardinality(v_result_ids),0) <> jsonb_array_length(p_payload->'sourceResultIds') OR
     (p_payload->>'primaryResultId')::bigint <> ALL(v_result_ids) THEN
    RAISE EXCEPTION 'Invalid Learning source result IDs' USING ERRCODE='22023';
  END IF;
  SELECT count(DISTINCT result_id)::integer INTO v_sample FROM (
    SELECT DISTINCT ON (f.ai_result_id) f.ai_result_id AS result_id, f.decision
    FROM public.ai_result_feedback_events f WHERE f.ai_result_id=ANY(v_result_ids)
    ORDER BY f.ai_result_id,f.created_at DESC,f.id DESC
  ) latest WHERE latest.decision IN ('accepted','modified','rejected');
  IF v_sample<>cardinality(v_result_ids) OR EXISTS (
    SELECT 1 FROM unnest(v_result_ids) AS src(id) WHERE NOT EXISTS (
      SELECT 1 FROM public.outcomes o WHERE o.ai_result_id=src.id
    )
  ) THEN RAISE EXCEPTION 'Every Learning source needs a decision and linked actual Outcome' USING ERRCODE='23503'; END IF;
  IF p_payload ? 'counterexampleIds' THEN
    SELECT jsonb_agg(to_jsonb(value::bigint)) INTO v_counterexamples
      FROM jsonb_array_elements_text(p_payload->'counterexampleIds') e(value)
      WHERE value ~ '^[1-9][0-9]{0,18}$';
    IF COALESCE(v_counterexamples,'[]'::jsonb) <> p_payload->'counterexampleIds' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_payload->'counterexampleIds') e(value)
      WHERE NOT (value::bigint=ANY(v_result_ids))
    ) THEN RAISE EXCEPTION 'Counterexamples must be selected from the source results' USING ERRCODE='22023'; END IF;
  ELSE v_counterexamples:='[]'::jsonb; END IF;
  SELECT jsonb_agg(jsonb_build_object('aiResultId',src.id,'decisionEventId',latest.id,
      'decision',latest.decision,'outcomeIds',outs.ids) ORDER BY src.id)
    INTO v_sources
    FROM unnest(v_result_ids) AS src(id)
    JOIN LATERAL (SELECT f.id,f.decision FROM public.ai_result_feedback_events f
      WHERE f.ai_result_id=src.id ORDER BY f.created_at DESC,f.id DESC LIMIT 1) latest ON true
    JOIN LATERAL (SELECT jsonb_agg(o.id ORDER BY o.occurred_at,o.id) AS ids FROM public.outcomes o
      WHERE o.ai_result_id=src.id) outs ON true;
  v_provenance:=jsonb_build_object('kind','pc29_feedback_outcome_sample','actorUid',p_actor_uid,
    'capturedAt',now(),'sources',v_sources);
  INSERT INTO public.learnings(source_type,source_table,source_id,situation,ai_recommendation,
      actual_action,learning,confidence,scope,confirmed,sample_size,counterexamples,provenance,candidate_key)
    VALUES('ai_recommendation','ai_results',(p_payload->>'primaryResultId')::bigint,
      btrim(p_payload->>'situation'),NULLIF(btrim(p_payload->>'recommendation'),''),
      NULLIF(btrim(p_payload->>'actualAction'),''),btrim(p_payload->>'learning'),
      CASE WHEN p_payload ? 'confidence' THEN (p_payload->>'confidence')::numeric END,
      btrim(p_payload->>'scope'),false,v_sample,v_counterexamples,v_provenance,p_candidate_key)
    RETURNING * INTO v_learning;
  RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'sampleSize',v_learning.sample_size,
    'counterexamples',v_learning.counterexamples,'provenance',v_learning.provenance,'confirmed',false,'replayed',false);
END;
$function$;

CREATE FUNCTION public.crm_ai_experience_confirm_learning_v1(p_actor_uid text,p_learning_id bigint,p_decision text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
DECLARE v_learning public.learnings%ROWTYPE;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_learning_id IS NULL OR
     length(btrim(COALESCE(p_decision,''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid Learning confirmation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_learning FROM public.learnings WHERE id=p_learning_id AND candidate_key IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PC29 Learning candidate is unavailable' USING ERRCODE='23503'; END IF;
  IF v_learning.confirmed THEN
    IF v_learning.confirmed_by_uid=p_actor_uid AND v_learning.user_decision=btrim(p_decision) THEN
      RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'confirmed',true,'replayed',true);
    END IF;
    RAISE EXCEPTION 'Learning candidate was already reviewed' USING ERRCODE='40001';
  END IF;
  UPDATE public.learnings SET confirmed=true,confirmed_by_uid=p_actor_uid,confirmed_at=now(),
    user_decision=btrim(p_decision) WHERE id=p_learning_id RETURNING * INTO v_learning;
  RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'confirmed',true,'replayed',false);
END;
$function$;

CREATE FUNCTION public.crm_ai_experience_metrics_v1(p_window_days integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION 'Invalid metrics window' USING ERRCODE='22023';
  END IF;
  WITH latest AS (
    SELECT DISTINCT ON (f.ai_result_id) f.ai_result_id,f.decision,f.created_at
    FROM public.ai_result_feedback_events f
    WHERE f.created_at >= now() - make_interval(days => p_window_days)
    ORDER BY f.ai_result_id,f.created_at DESC,f.id DESC
  )
  SELECT jsonb_build_object(
    'windowDays',p_window_days,
    'from',now()-make_interval(days => p_window_days),
    'to',now(),
    'numerator',count(*) FILTER (WHERE decision IN ('accepted','modified')),
    'denominator',count(*) FILTER (WHERE decision IN ('accepted','modified','rejected')),
    'pending',count(*) FILTER (WHERE decision='pending')
  ) INTO v_result FROM latest;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_ai_experience_decide_v1(text,uuid,bigint,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_experience_decide_v1(text,uuid,bigint,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ai_experience_outcome_v1(text,uuid,text,bigint,bigint,text,timestamptz,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_experience_outcome_v1(text,uuid,text,bigint,bigint,text,timestamptz,text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ai_experience_learning_v1(text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_experience_learning_v1(text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ai_experience_confirm_learning_v1(text,bigint,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_experience_confirm_learning_v1(text,bigint,text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ai_experience_metrics_v1(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_experience_metrics_v1(integer) TO service_role;

COMMENT ON TABLE public.ai_result_feedback_events IS
  'PC29 append-only human decisions for AI result adoption; opening/copying is not a decision';
COMMENT ON COLUMN public.outcomes.evidence IS 'Human-recorded evidence supporting this actual Outcome';
COMMENT ON COLUMN public.outcomes.recorded_by_uid IS 'Authenticated human who recorded this actual Outcome';
COMMENT ON COLUMN public.learnings.provenance IS 'PC29 source AI decision and linked Outcome IDs used for this candidate';
NOTIFY pgrst, 'reload schema';
COMMIT;
