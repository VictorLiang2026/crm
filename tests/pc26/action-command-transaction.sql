-- Run only against CRM's registered fictional fixture: person 783 / action 6.
-- Every mutation and command-ledger row is rolled back by the ZX001 sentinel.
DO $pc26_test$
DECLARE
  v_actor text := 'pc26-rollback-only-test';
  v_cmd jsonb;
  v_preview jsonb;
  v_confirm jsonb;
  v_exec jsonb;
  v_replay jsonb;
  v_hash text;
  v_id uuid;
  v_original_updated_at timestamptz;
  v_original_person_updated_at timestamptz;
  v_row public.actions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_test_records
      WHERE batch_key='crm_test_main_v1' AND record_table='persons' AND record_id='783') OR
     NOT EXISTS (SELECT 1 FROM public.crm_test_records
      WHERE batch_key='crm_test_main_v1' AND record_table='actions' AND record_id='6') OR
     NOT EXISTS (SELECT 1 FROM public.actions WHERE id=6 AND person_id=783 AND status='open') THEN
    RAISE EXCEPTION 'Expected registered fictional fixture person 783/action 6';
  END IF;
  SELECT updated_at INTO v_original_updated_at FROM public.actions WHERE id=6 AND person_id=783;
  SELECT updated_at INTO v_original_person_updated_at FROM public.persons WHERE id=783;

  -- Cross-Person target is rejected before a command can be authorized.
  BEGIN
    PERFORM public.assistant_action_command_v1('plan',v_actor,NULL,784,
      '{"operation":"update","targetActionId":6,"changes":{"title":"【系统测试·勿联系】越界"}}'::jsonb,NULL);
    RAISE EXCEPTION 'Cross-Person action unexpectedly planned';
  EXCEPTION WHEN SQLSTATE '23503' THEN NULL;
  END;

  -- Payload allowlist and the 15-minute authorization window are enforced in SQL.
  BEGIN
    PERFORM public.assistant_action_command_v1('plan',v_actor,NULL,783,
      '{"operation":"update","targetActionId":6,"changes":{"status":"completed"}}'::jsonb,NULL);
    RAISE EXCEPTION 'Disallowed status update unexpectedly planned';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_cmd := public.assistant_action_command_v1('plan',v_actor,NULL,783,
    '{"operation":"update","targetActionId":6,"changes":{"title":"【系统测试·勿联系】过期命令"}}'::jsonb,NULL);
  v_id := (v_cmd->>'commandId')::uuid;
  UPDATE public.assistant_action_commands SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=v_id;
  BEGIN
    PERFORM public.assistant_action_command_v1('preview',v_actor,v_id,NULL,NULL,NULL);
    RAISE EXCEPTION 'Expired command unexpectedly previewed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Person version changes also invalidate a previously confirmed Action command.
  v_cmd := public.assistant_action_command_v1('plan',v_actor,NULL,783,
    '{"operation":"update","targetActionId":6,"changes":{"title":"【系统测试·勿联系】Person版本过期"}}'::jsonb,NULL);
  v_id := (v_cmd->>'commandId')::uuid;
  v_preview := public.assistant_action_command_v1('preview',v_actor,v_id,NULL,NULL,NULL);
  PERFORM public.assistant_action_command_v1('confirm',v_actor,v_id,NULL,NULL,v_preview->>'previewHash');
  UPDATE public.persons SET updated_at=clock_timestamp() WHERE id=783;
  BEGIN
    PERFORM public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
    RAISE EXCEPTION 'Stale Person unexpectedly executed';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  UPDATE public.persons SET updated_at=v_original_person_updated_at WHERE id=783;

  -- Update: DB preview, forged confirmation rejection, optimistic-version rejection.
  v_cmd := public.assistant_action_command_v1('plan',v_actor,NULL,783,
    '{"operation":"update","targetActionId":6,"changes":{"title":"【系统测试·勿联系】PC26事务回滚验证","priority":"high"}}'::jsonb,NULL);
  v_id := (v_cmd->>'commandId')::uuid;
  v_preview := public.assistant_action_command_v1('preview',v_actor,v_id,NULL,NULL,NULL);
  IF v_preview->'preview'->'before'->>'title' <> '【系统测试·勿联系】下一步体验行动' OR
     v_preview->'preview'->'after'->>'priority' <> 'high' THEN
    RAISE EXCEPTION 'Update preview mismatch';
  END IF;
  v_hash := v_preview->>'previewHash';
  BEGIN
    PERFORM public.assistant_action_command_v1('confirm',v_actor,v_id,NULL,NULL,repeat('0',32));
    RAISE EXCEPTION 'Forged confirmation unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  v_confirm := public.assistant_action_command_v1('confirm',v_actor,v_id,NULL,NULL,v_hash);
  IF v_confirm->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'Valid confirmation failed'; END IF;
  UPDATE public.actions SET updated_at=clock_timestamp() WHERE id=6 AND person_id=783;
  BEGIN
    PERFORM public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
    RAISE EXCEPTION 'Stale Action unexpectedly executed';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  -- Undo the synthetic version change inside the test block so a fresh command can run.
  UPDATE public.actions SET updated_at=v_original_updated_at WHERE id=6 AND person_id=783;
  v_cmd := public.assistant_action_command_v1('plan',v_actor,NULL,783,
    '{"operation":"update","targetActionId":6,"changes":{"title":"【系统测试·勿联系】PC26事务回滚验证","priority":"high"}}'::jsonb,NULL);
  v_id := (v_cmd->>'commandId')::uuid;
  v_preview := public.assistant_action_command_v1('preview',v_actor,v_id,NULL,NULL,NULL);
  v_hash := v_preview->>'previewHash';
  PERFORM public.assistant_action_command_v1('confirm',v_actor,v_id,NULL,NULL,v_hash);
  v_exec := public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
  SELECT * INTO v_row FROM public.actions WHERE id=6;
  IF v_exec->>'status' <> 'executed' OR v_row.title <> '【系统测试·勿联系】PC26事务回滚验证' OR
     v_row.priority <> 'high' OR v_row.status <> 'open' THEN RAISE EXCEPTION 'Update execute mismatch'; END IF;
  v_replay := public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
  IF v_replay->>'replayed' <> 'true' OR v_replay->>'businessDataWritten' <> 'false' THEN
    RAISE EXCEPTION 'Update replay was not idempotent';
  END IF;

  -- Close: only open/in-progress -> completed; timestamp and actor are server generated.
  v_cmd := public.assistant_action_command_v1('plan',v_actor,NULL,783,
    '{"operation":"close","targetActionId":6,"changes":{}}'::jsonb,NULL);
  v_id := (v_cmd->>'commandId')::uuid;
  v_preview := public.assistant_action_command_v1('preview',v_actor,v_id,NULL,NULL,NULL);
  IF v_preview->'preview'->'before'->>'status' <> 'open' OR
     v_preview->'preview'->'after'->>'status' <> 'completed' THEN RAISE EXCEPTION 'Close preview mismatch'; END IF;
  v_hash := v_preview->>'previewHash';
  PERFORM public.assistant_action_command_v1('confirm',v_actor,v_id,NULL,NULL,v_hash);
  v_exec := public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
  SELECT * INTO v_row FROM public.actions WHERE id=6;
  IF v_exec->>'status' <> 'executed' OR v_row.status <> 'completed' OR v_row.completed_at IS NULL OR
     v_row.completed_by_uid <> v_actor THEN RAISE EXCEPTION 'Close execute mismatch'; END IF;
  v_replay := public.assistant_action_command_v1('execute',v_actor,v_id,NULL,NULL,NULL);
  IF v_replay->>'replayed' <> 'true' OR v_replay->>'businessDataWritten' <> 'false' THEN
    RAISE EXCEPTION 'Close replay was not idempotent';
  END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='PC26 test rollback sentinel';
EXCEPTION WHEN SQLSTATE 'ZX001' THEN
  RAISE NOTICE 'PC26 PASS; fictional Action and command ledger rolled back';
END;
$pc26_test$;
