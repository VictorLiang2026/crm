-- PC32 recruit: actual transition RPC must wait and reject at 500 ms.
DO $test$
DECLARE
  v_version timestamptz;
  v_blocked boolean := false;
BEGIN
  SELECT updated_at INTO v_version FROM public.recruit_candidates
    WHERE id=19 AND person_id=784 AND stage='新增人才' AND deleted_at IS NULL;
  IF v_version IS NULL THEN RAISE EXCEPTION 'PC32 registered recruit version unavailable'; END IF;
  PERFORM pg_catalog.set_config('lock_timeout','500ms',true);
  BEGIN
    PERFORM public.crm_recruit_candidate_transition_v1(
      '[CRM_TEST_ONLY] PC32 recruit actor',19,784,v_version,'新增人才',
      '【系统测试·勿联系】并发只读阶段','【系统测试·勿联系】测试');
  EXCEPTION WHEN SQLSTATE '55P03' THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 recruit contender did not wait on row'; END IF;
END $test$;
