-- Run this single DO as service_role. Every mutation is undone by nested ZX001.
DO $pc28_stale$
DECLARE
  v_actor text := 'pc28-rollback-only-test';
  v_cmd uuid;
  v_preview jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recruit_candidates
      WHERE id=20 AND person_id=786 AND customer_id IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Fictional PC28 fixture changed';
  END IF;
  BEGIN
    PERFORM public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
      gen_random_uuid(),785,20,'【系统测试·勿联系】跨人物目标','【系统测试·勿联系】虚构人物',NULL);
    RAISE EXCEPTION 'Cross-Person target accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    v_cmd := (public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
      gen_random_uuid(),786,20,'【系统测试·勿联系】过期预览','【系统测试·勿联系】虚构人物',NULL)->>'commandId')::uuid;
    UPDATE public.assistant_recruit_delete_commands
      SET expires_at=now()-interval '1 minute' WHERE id=v_cmd;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('preview',v_actor,v_cmd);
      RAISE EXCEPTION 'Expired command accepted';
    EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
    END;
    RAISE EXCEPTION 'intentional rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF EXISTS (SELECT 1 FROM public.assistant_recruit_delete_commands WHERE id=v_cmd) THEN
      RAISE EXCEPTION 'Expired command leaked';
    END IF;
  END;
  BEGIN
    v_cmd := (public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
      gen_random_uuid(),786,20,'【系统测试·勿联系】版本冲突','【系统测试·勿联系】虚构人物',NULL)->>'commandId')::uuid;
    v_preview := public.assistant_recruit_delete_command_v1('preview',v_actor,v_cmd);
    PERFORM public.assistant_recruit_delete_command_v1('confirm',v_actor,v_cmd,
      NULL,NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    UPDATE public.recruit_followups SET updated_at=clock_timestamp()
      WHERE id=3 AND candidate_id=20;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('execute',v_actor,v_cmd);
      RAISE EXCEPTION 'Stale impact accepted';
    EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
    END;
    RAISE EXCEPTION 'intentional rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF EXISTS (SELECT 1 FROM public.assistant_recruit_delete_commands WHERE id=v_cmd) OR
       NOT EXISTS (SELECT 1 FROM public.recruit_followups
         WHERE id=3 AND candidate_id=20 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Stale check leaked mutation';
    END IF;
  END;
END;
$pc28_stale$;
