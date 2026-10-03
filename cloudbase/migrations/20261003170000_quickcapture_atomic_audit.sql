-- WP07: validate the command and link its AI audit in one transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
  IF to_regprocedure('public.quick_capture_v2_plan_v1(text,bigint,text,jsonb,bigint,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'WP07 atomic plan already exists; inspect before migrating';
  END IF;
  IF to_regprocedure('public.quick_capture_v2_command_v1(text,text,uuid,bigint,text,jsonb,text,bigint,bigint)') IS NULL OR
     to_regprocedure('public.crm_test_link_ai_v1(bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'WP07 plan dependencies missing';
  END IF;
END $guard$;

CREATE FUNCTION public.quick_capture_v2_plan_v1(
  p_actor_uid text, p_person_id bigint, p_selected_display_name text,
  p_draft jsonb, p_ai_task_id bigint, p_ai_result_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
DECLARE
  v_result jsonb;
  v_link jsonb;
BEGIN
  v_result := public.quick_capture_v2_command_v1('plan',p_actor_uid,NULL::uuid,
    p_person_id,p_selected_display_name,p_draft,NULL::text,p_ai_task_id,p_ai_result_id);
  v_link := public.crm_test_link_ai_v1(p_ai_task_id,
    jsonb_build_array(jsonb_build_object('table','persons','id',p_person_id::text)));
  IF coalesce((v_link->>'linkedBatches')::integer,0) < 1 THEN
    RAISE EXCEPTION 'Test AI audit was not linked' USING ERRCODE='23514';
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.quick_capture_v2_plan_v1(text,bigint,text,jsonb,bigint,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quick_capture_v2_plan_v1(text,bigint,text,jsonb,bigint,bigint)
  TO service_role;
COMMIT;
