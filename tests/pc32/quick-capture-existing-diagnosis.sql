-- PC32 read-only diagnosis by outer rollback: registered fictional Person 783.
-- The same existing-Person Quick Capture request currently creates two results.
DO $test$
DECLARE
  v_actor text := '[CRM_TEST_ONLY] PC32 Quick Capture actor';
  v_person bigint := 783;
  v_name text := '【系统测试·勿联系】虚构体验甲';
  v_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_interaction jsonb;
  v_facts jsonb := jsonb_build_array('【系统测试·勿联系】虚构事实');
  v_signals jsonb := jsonb_build_array('【系统测试·勿联系】虚构信号');
  v_first jsonb;
  v_second jsonb;
  v_first_id bigint;
  v_second_id bigint;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='persons'
      AND r.record_id=v_person::text) OR NOT EXISTS(
    SELECT 1 FROM public.persons WHERE id=v_person AND display_name=v_name
      AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'PC32 fictional Quick Capture Person changed'; END IF;
  v_interaction:=jsonb_build_object('type','微信','at',v_at,'channel','',
    'summary','【系统测试·勿联系】PC32 相同请求重复核验',
    'rawNote','【系统测试·勿联系】虚构文字，无真实联系方式');
  BEGIN
    v_first:=public.quick_capture_v2_commit(v_person,v_name,v_actor,
      v_interaction,v_facts,v_signals);
    v_second:=public.quick_capture_v2_commit(v_person,v_name,v_actor,
      v_interaction,v_facts,v_signals);
    v_first_id:=(v_first->>'interactionId')::bigint;
    v_second_id:=(v_second->>'interactionId')::bigint;
    IF v_first_id IS NULL OR v_second_id IS NULL OR v_first_id=v_second_id OR
       (v_first->>'contextItemCount')::integer<>2 OR
       (v_second->>'contextItemCount')::integer<>2 OR
       (SELECT count(*) FROM public.interactions
         WHERE id IN (v_first_id,v_second_id))<>2 OR
       (SELECT count(*) FROM public.context_items
         WHERE interaction_id IN (v_first_id,v_second_id))<>4
    THEN RAISE EXCEPTION 'PC32 Quick Capture duplicate diagnosis no longer reproduces'; END IF;
    RAISE EXCEPTION 'PC32_QUICK_CAPTURE_DIAGNOSIS_ROLLBACK' USING ERRCODE='P32Q0';
  EXCEPTION WHEN SQLSTATE 'P32Q0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.interactions WHERE id IN (v_first_id,v_second_id)) OR
     EXISTS(SELECT 1 FROM public.context_items
       WHERE interaction_id IN (v_first_id,v_second_id))
  THEN RAISE EXCEPTION 'PC32 Quick Capture diagnosis leaked business rows'; END IF;
  RAISE NOTICE 'PC32 existing-Person duplicate reproduced and rolled back: %, %',
    v_first_id,v_second_id;
END $test$;
