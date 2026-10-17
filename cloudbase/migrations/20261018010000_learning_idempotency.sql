-- PC32-A: one existing public RPC; no table, privilege, or UI changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef('public.crm_ai_experience_learning_v1(text,uuid,jsonb)'::regprocedure))
     <> '35d51ed4e311dcee8764c470e53f93ec' THEN
    RAISE EXCEPTION 'PC32-A Learning function baseline changed; review before migration';
  END IF;
END
$guard$;
CREATE OR REPLACE FUNCTION public.crm_ai_experience_learning_v1(p_actor_uid text, p_candidate_key uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_learning public.learnings%ROWTYPE;
  v_result_ids bigint[];
  v_primary bigint;
  v_sample integer;
  v_counterexamples jsonb;
  v_provenance jsonb;
  v_sources jsonb;
  v_request jsonb;
  v_previous jsonb;
  v_previous_ids jsonb;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_candidate_key IS NULL OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Learning candidate' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_payload)) NOT BETWEEN 5 AND 9 OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
       ('sourceResultIds','primaryResultId','situation','recommendation','actualAction','learning','scope','confidence','counterexampleIds')) OR
     jsonb_typeof(p_payload->'sourceResultIds') IS DISTINCT FROM 'array' OR
     jsonb_typeof(p_payload->'primaryResultId') IS DISTINCT FROM 'number' OR
     COALESCE(p_payload->>'primaryResultId','') !~ '^[1-9][0-9]{0,18}$' OR
     jsonb_typeof(p_payload->'situation') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_payload->'learning') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_payload->'scope') IS DISTINCT FROM 'string' OR
     length(btrim(p_payload->>'situation')) NOT BETWEEN 1 AND 2000 OR
     length(btrim(p_payload->>'learning')) NOT BETWEEN 1 AND 4000 OR
     length(btrim(p_payload->>'scope')) NOT BETWEEN 1 AND 128 OR
     (COALESCE(jsonb_typeof(p_payload->'recommendation'),'null') NOT IN ('string','null')) OR
     (COALESCE(jsonb_typeof(p_payload->'actualAction'),'null') NOT IN ('string','null')) OR
     length(p_payload->>'recommendation')>4000 OR length(p_payload->>'actualAction')>4000 OR
     (COALESCE(jsonb_typeof(p_payload->'confidence'),'null') NOT IN ('number','null')) OR
     (p_payload ? 'counterexampleIds' AND jsonb_typeof(p_payload->'counterexampleIds') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid Learning candidate' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_payload->'sourceResultIds') NOT BETWEEN 1 AND 100 OR
     (p_payload->>'confidence')::numeric NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'Invalid Learning candidate' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) INTO v_result_ids
    FROM jsonb_array_elements_text(p_payload->'sourceResultIds') e(value)
    WHERE value ~ '^[1-9][0-9]{0,18}$';
  v_primary := (p_payload->>'primaryResultId')::bigint;
  IF COALESCE(cardinality(v_result_ids),0) <> jsonb_array_length(p_payload->'sourceResultIds') OR
     v_primary <> ALL(v_result_ids) THEN
    RAISE EXCEPTION 'Invalid Learning source result IDs' USING ERRCODE='22023';
  END IF;
  IF p_payload ? 'counterexampleIds' THEN
    SELECT jsonb_agg(to_jsonb(value::bigint) ORDER BY ordinal) INTO v_counterexamples
      FROM jsonb_array_elements_text(p_payload->'counterexampleIds') WITH ORDINALITY e(value,ordinal)
      WHERE value ~ '^[1-9][0-9]{0,18}$';
    v_counterexamples := COALESCE(v_counterexamples,'[]'::jsonb);
    IF v_counterexamples <> p_payload->'counterexampleIds' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_counterexamples) e(value)
      WHERE NOT (value::bigint=ANY(v_result_ids))
    ) THEN RAISE EXCEPTION 'Counterexamples must be selected from the source results' USING ERRCODE='22023'; END IF;
  ELSE v_counterexamples := '[]'::jsonb; END IF;

  -- Compare complete normalized values, not a lossy digest. Source IDs are a set;
  -- counterexample order and multiplicity retain the previous API semantics.
  v_request := jsonb_build_object('sourceResultIds',to_jsonb(v_result_ids),'primaryResultId',v_primary,
    'situation',btrim(p_payload->>'situation'),'recommendation',NULLIF(btrim(p_payload->>'recommendation'),''),
    'actualAction',NULLIF(btrim(p_payload->>'actualAction'),''),'learning',btrim(p_payload->>'learning'),
    'scope',btrim(p_payload->>'scope'),'confidence',(p_payload->>'confidence')::numeric,
    'counterexampleIds',v_counterexamples);

  -- Both first submissions and retries serialize by key. Hash collisions only
  -- serialize unrelated keys; full key/actor/payload equality is checked below.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm.learning:' || p_candidate_key::text,0));
  SELECT * INTO v_learning FROM public.learnings WHERE candidate_key=p_candidate_key FOR UPDATE;
  IF FOUND THEN
    IF v_learning.provenance->>'actorUid' IS DISTINCT FROM p_actor_uid THEN
      RAISE EXCEPTION 'Candidate key was reused by a different actor' USING ERRCODE='22023';
    END IF;
    IF v_learning.provenance ? 'requestPayload' THEN
      IF v_learning.provenance->'requestVersion' IS DISTINCT FROM '1'::jsonb THEN
        RAISE EXCEPTION 'Learning request audit version is unavailable' USING ERRCODE='22023';
      END IF;
      v_previous := v_learning.provenance->'requestPayload';
    ELSE
      -- Historical PC29 rows: reconstruct only from persisted facts. Missing
      -- actor/source audit fails closed; do not backfill or guess an identity.
      IF jsonb_typeof(v_learning.provenance->'sources') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Historical Learning source audit is unavailable' USING ERRCODE='22023';
      END IF;
      SELECT jsonb_agg(to_jsonb((src->>'aiResultId')::bigint) ORDER BY (src->>'aiResultId')::bigint)
        INTO v_previous_ids FROM jsonb_array_elements(v_learning.provenance->'sources') src;
      v_previous := jsonb_build_object('sourceResultIds',v_previous_ids,'primaryResultId',v_learning.source_id,
        'situation',v_learning.situation,'recommendation',v_learning.ai_recommendation,
        'actualAction',v_learning.actual_action,'learning',v_learning.learning,'scope',v_learning.scope,
        'confidence',v_learning.confidence,'counterexampleIds',COALESCE(v_learning.counterexamples,'[]'::jsonb));
    END IF;
    IF v_previous IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Candidate key was reused with different input' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'sampleSize',v_learning.sample_size,'replayed',true);
  END IF;

  -- One statement snapshots the latest decisions and actual Outcomes together;
  -- validate precisely the evidence that will be stored, without a second read.
  SELECT jsonb_agg(jsonb_build_object('aiResultId',src.id,'decisionEventId',latest.id,
      'decision',latest.decision,'outcomeIds',outs.ids) ORDER BY src.id)
    INTO v_sources FROM unnest(v_result_ids) AS src(id)
    JOIN LATERAL (SELECT f.id,f.decision FROM public.ai_result_feedback_events f
      WHERE f.ai_result_id=src.id ORDER BY f.created_at DESC,f.id DESC LIMIT 1) latest ON true
    JOIN LATERAL (SELECT jsonb_agg(o.id ORDER BY o.occurred_at,o.id) AS ids FROM public.outcomes o
      WHERE o.ai_result_id=src.id) outs ON true
    WHERE latest.decision IN ('accepted','modified','rejected') AND outs.ids IS NOT NULL;
  v_sample := COALESCE(jsonb_array_length(v_sources),0);
  IF v_sample <> cardinality(v_result_ids) THEN
    RAISE EXCEPTION 'Every Learning source needs a decision and linked actual Outcome' USING ERRCODE='23503';
  END IF;
  v_provenance := jsonb_build_object('kind','pc29_feedback_outcome_sample','actorUid',p_actor_uid,
    'capturedAt',now(),'sources',v_sources,'requestVersion',1,'requestPayload',v_request);
  INSERT INTO public.learnings(source_type,source_table,source_id,situation,ai_recommendation,
      actual_action,learning,confidence,scope,confirmed,sample_size,counterexamples,provenance,candidate_key)
    VALUES('ai_recommendation','ai_results',v_primary,
      v_request->>'situation',v_request->>'recommendation',v_request->>'actualAction',v_request->>'learning',
      (v_request->>'confidence')::numeric,v_request->>'scope',false,v_sample,v_counterexamples,v_provenance,p_candidate_key)
    RETURNING * INTO v_learning;
  RETURN jsonb_build_object('ok',true,'learningId',v_learning.id,'sampleSize',v_learning.sample_size,
    'counterexamples',v_learning.counterexamples,'provenance',v_learning.provenance,'confirmed',false,'replayed',false);
END;
$function$;
NOTIFY pgrst, 'reload schema';
COMMIT;
