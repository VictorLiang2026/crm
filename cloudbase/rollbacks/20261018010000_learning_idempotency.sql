-- PC32-A code rollback only; retains all Learning rows and audits.
-- This restores weaker historical replay checks: evaluate operational risk before use.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.crm_ai_experience_learning_v1(text,uuid,jsonb)'::regprocedure) <> '980622b8b8cf607b2c49831e3fc187de' THEN
    RAISE EXCEPTION 'PC32-A rollback baseline changed; review before restoring';
  END IF;
END
$guard$;
CREATE OR REPLACE FUNCTION public.crm_ai_experience_learning_v1(p_actor_uid text, p_candidate_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    WHERE value ~ '^[1-9][0-9]{0,18};
NOTIFY pgrst, 'reload schema';
COMMIT;
;
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
      WHERE value ~ '^[1-9][0-9]{0,18};
NOTIFY pgrst, 'reload schema';
COMMIT;
;
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
$function$
;
NOTIFY pgrst, 'reload schema';
COMMIT;
