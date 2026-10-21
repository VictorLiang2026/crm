-- Restore the PC33 shape guard. Existing AI audit rows are retained.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.crm_ai_claim_v2(
  p_actor_uid text, p_request_key text, p_task_type text, p_skill_name text,
  p_subject_type text, p_subject_id text, p_capability text,
  p_input_snapshot jsonb, p_context_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $fn$
DECLARE v_task public.ai_tasks%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'AI audit service role required'; END IF;
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 256
     OR p_request_key IS NULL OR p_request_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid AI claim key';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_actor_uid),
    pg_catalog.hashtext(p_request_key));
  SELECT t.* INTO v_task FROM public.ai_request_claims c
    JOIN public.ai_tasks t ON t.id=c.task_id
    WHERE c.actor_uid=p_actor_uid AND c.request_key=p_request_key
    FOR SHARE OF t;
  IF FOUND AND (v_task.task_type IS DISTINCT FROM p_task_type
     OR v_task.skill_name IS DISTINCT FROM p_skill_name
     OR v_task.subject_type IS DISTINCT FROM p_subject_type
     OR v_task.subject_id IS DISTINCT FROM p_subject_id
     OR v_task.capability IS DISTINCT FROM p_capability
     OR v_task.input_snapshot IS DISTINCT FROM p_input_snapshot
     OR v_task.context_snapshot IS DISTINCT FROM p_context_snapshot) THEN
    RAISE EXCEPTION 'AI claim key reused with different input';
  END IF;
  RETURN public.crm_ai_claim_v1(p_actor_uid,p_request_key,p_task_type,p_skill_name,
    p_subject_type,p_subject_id,p_capability,p_input_snapshot,p_context_snapshot);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)
  TO service_role;
COMMIT;
