-- PC33: short-lived server-side AI request claims and transactional audit finalization.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regclass('public.ai_request_claims') IS NOT NULL
     OR to_regprocedure('public.crm_ai_claim_v1(text,text,text,text,text,text,text,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'PC33 AI audit objects already exist; inspect before migrating';
  END IF;
END $guard$;

CREATE TABLE public.ai_request_claims (
  actor_uid text NOT NULL,
  request_key text NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  task_id bigint NOT NULL UNIQUE REFERENCES public.ai_tasks(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_uid, request_key),
  CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 256)
);
CREATE INDEX ai_request_claims_expiry_idx ON public.ai_request_claims(expires_at);
ALTER TABLE public.ai_request_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_request_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_request_claims_service_only ON public.ai_request_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.ai_request_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_request_claims TO service_role;

CREATE FUNCTION public.crm_ai_claim_v1(
  p_actor_uid text, p_request_key text, p_task_type text, p_skill_name text,
  p_subject_type text, p_subject_id text, p_capability text,
  p_input_snapshot jsonb, p_context_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_claim public.ai_request_claims%ROWTYPE;
  v_task public.ai_tasks%ROWTYPE;
  v_run public.ai_runs%ROWTYPE;
  v_result public.ai_results%ROWTYPE;
  v_task_id bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'AI audit service role required'; END IF;
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 256
     OR p_request_key IS NULL OR p_request_key !~ '^[0-9a-f]{64}$'
     OR p_task_type IS NULL OR length(btrim(p_task_type)) NOT BETWEEN 1 AND 100
     OR p_skill_name IS NULL OR length(btrim(p_skill_name)) NOT BETWEEN 1 AND 100
     OR p_capability IS NULL OR length(btrim(p_capability)) NOT BETWEEN 1 AND 100
     OR (p_subject_type IS NULL) <> (p_subject_id IS NULL)
     OR jsonb_typeof(p_input_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_context_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid AI claim input';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_actor_uid),
    pg_catalog.hashtext(p_request_key));
  SELECT * INTO v_claim FROM public.ai_request_claims
    WHERE actor_uid = p_actor_uid AND request_key = p_request_key FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_task FROM public.ai_tasks WHERE id = v_claim.task_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI claim has no task'; END IF;
    IF v_task.status IN ('running', 'pending') THEN
      IF v_claim.expires_at <= now() THEN
        RETURN jsonb_build_object('status','audit_unknown','taskId',v_task.id);
      END IF;
      RETURN jsonb_build_object('status','in_progress','taskId',v_task.id);
    END IF;
    IF v_claim.expires_at > now() THEN
      IF v_task.status = 'failed' THEN
        RETURN jsonb_build_object('status','recent_failure','taskId',v_task.id,
          'retryAfter',ceil(extract(epoch FROM v_claim.expires_at-now()))::integer);
      END IF;
      IF v_task.status = 'completed' THEN
        SELECT r.* INTO v_run FROM public.ai_runs r
          WHERE r.task_id = v_task.id AND r.success IS TRUE ORDER BY r.id DESC LIMIT 1;
        SELECT z.* INTO v_result FROM public.ai_results z
          WHERE z.task_id = v_task.id AND z.run_id = v_run.id ORDER BY z.id DESC LIMIT 1;
        IF v_run.id IS NULL OR v_result.id IS NULL THEN
          RETURN jsonb_build_object('status','audit_unknown','taskId',v_task.id);
        END IF;
        RETURN jsonb_build_object('status','reused','taskId',v_task.id,
          'runId',v_run.id,'resultId',v_result.id,'result',v_result.result_json,
          'usage',jsonb_build_object('provider',v_run.provider,'model',v_run.model,
            'input_tokens',v_run.input_tokens,'output_tokens',v_run.output_tokens,
            'cached_tokens',v_run.cached_tokens,'cost',v_run.cost),
          'testData',v_task.context_snapshot->'_testData',
          'skillVersion',v_task.context_snapshot#>>'{_skill,version}');
      END IF;
      RETURN jsonb_build_object('status','audit_unknown','taskId',v_task.id);
    END IF;
  END IF;

  INSERT INTO public.ai_tasks(task_type,skill_name,subject_type,subject_id,status,
    capability,input_snapshot,context_snapshot,requires_confirmation)
  VALUES (p_task_type,p_skill_name,p_subject_type,p_subject_id,'running',
    p_capability,p_input_snapshot,p_context_snapshot,true) RETURNING id INTO v_task_id;
  IF v_claim.task_id IS NULL THEN
    INSERT INTO public.ai_request_claims(actor_uid,request_key,task_id,expires_at)
      VALUES (p_actor_uid,p_request_key,v_task_id,now()+interval '3 minutes');
  ELSE
    UPDATE public.ai_request_claims SET task_id=v_task_id,
      expires_at=now()+interval '3 minutes', created_at=now()
      WHERE actor_uid=p_actor_uid AND request_key=p_request_key;
  END IF;
  RETURN jsonb_build_object('status','claimed','taskId',v_task_id);
END $fn$;

CREATE FUNCTION public.crm_ai_finish_v1(
  p_task_id bigint, p_run_id bigint, p_success boolean, p_error text,
  p_usage jsonb, p_result jsonb, p_final boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_task public.ai_tasks%ROWTYPE;
  v_run public.ai_runs%ROWTYPE;
  v_result_id bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'AI audit service role required'; END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 OR p_success IS NULL OR p_final IS NULL
     OR jsonb_typeof(p_usage) IS DISTINCT FROM 'object'
     OR (p_success AND (p_run_id IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'))
     OR (NOT p_success AND (p_error IS NULL OR length(p_error) NOT BETWEEN 1 AND 100))
     OR (p_run_id IS NULL AND (p_success OR NOT p_final)) THEN
    RAISE EXCEPTION 'Invalid AI finalization input';
  END IF;
  SELECT * INTO v_task FROM public.ai_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI task not found'; END IF;
  IF p_run_id IS NULL THEN
    IF v_task.status = 'running' THEN
      UPDATE public.ai_tasks SET status='failed',completed_at=now() WHERE id=p_task_id;
    ELSIF v_task.status <> 'failed' THEN
      RAISE EXCEPTION 'AI task already finalized differently';
    END IF;
    RETURN jsonb_build_object('status','failed','taskId',p_task_id);
  END IF;
  SELECT * INTO v_run FROM public.ai_runs WHERE id=p_run_id AND task_id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI run not found for task'; END IF;
  IF v_run.success IS NOT NULL THEN
    IF v_run.success IS DISTINCT FROM p_success THEN RAISE EXCEPTION 'AI run replay changed outcome'; END IF;
    IF p_success THEN
      SELECT id INTO v_result_id FROM public.ai_results
        WHERE task_id=p_task_id AND run_id=p_run_id ORDER BY id DESC LIMIT 1;
      IF v_result_id IS NULL THEN RAISE EXCEPTION 'AI completed run has no result'; END IF;
      RETURN jsonb_build_object('status','completed','taskId',p_task_id,
        'runId',p_run_id,'resultId',v_result_id);
    END IF;
    RETURN jsonb_build_object('status',CASE WHEN v_task.status='failed' THEN 'failed' ELSE 'retry' END,
      'taskId',p_task_id,'runId',p_run_id);
  END IF;
  IF v_task.status <> 'running' THEN RAISE EXCEPTION 'AI task is not running'; END IF;
  UPDATE public.ai_runs SET success=p_success,
    error=CASE WHEN p_success THEN NULL ELSE p_error END,
    provider=p_usage->>'provider',model=p_usage->>'model',
    input_tokens=NULLIF(p_usage->>'input_tokens','')::bigint,
    output_tokens=NULLIF(p_usage->>'output_tokens','')::bigint,
    cached_tokens=NULLIF(p_usage->>'cached_tokens','')::bigint,
    cost=NULLIF(p_usage->>'cost','')::numeric,
    latency_ms=NULLIF(p_usage->>'latency_ms','')::bigint
    WHERE id=p_run_id;
  IF p_success THEN
    INSERT INTO public.ai_results(task_id,run_id,result_json,rank,is_recommended,
      user_selected,user_edited)
    VALUES (p_task_id,p_run_id,p_result,1,true,false,false)
    RETURNING id INTO v_result_id;
    UPDATE public.ai_tasks SET status='completed',completed_at=now() WHERE id=p_task_id;
    RETURN jsonb_build_object('status','completed','taskId',p_task_id,
      'runId',p_run_id,'resultId',v_result_id);
  END IF;
  IF p_final THEN
    UPDATE public.ai_tasks SET status='failed',completed_at=now() WHERE id=p_task_id;
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN p_final THEN 'failed' ELSE 'retry' END,
    'taskId',p_task_id,'runId',p_run_id);
END $fn$;

REVOKE ALL ON FUNCTION public.crm_ai_claim_v1(text,text,text,text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_claim_v1(text,text,text,text,text,text,text,jsonb,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)
  TO service_role;
COMMIT;
