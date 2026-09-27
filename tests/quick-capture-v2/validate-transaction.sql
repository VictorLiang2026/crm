-- One statement, explicitly marked fixtures, and a subtransaction that rolls back all writes.
DO $outer$
DECLARE
  v_result jsonb;
  v_before integer;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.persons WHERE id = -927210) THEN
      RAISE EXCEPTION 'V2 test Person ID already exists';
    END IF;
    INSERT INTO public.persons (id, display_name, name_key, source)
      VALUES (-927210, '[CRM_TEST_ONLY]V2人物', '[crm_test_only]v2人物', '[CRM_TEST_ONLY]');

    v_result := public.quick_capture_v2_commit(
      -927210, '[CRM_TEST_ONLY]V2人物', '[CRM_TEST_ONLY]uid',
      '{"type":"微信","at":"2026-09-27T12:00:00+08:00","channel":"微信","summary":"[CRM_TEST_ONLY]互动","rawNote":"[CRM_TEST_ONLY]原话"}'::jsonb,
      '["[CRM_TEST_ONLY]事实候选"]'::jsonb,
      '["[CRM_TEST_ONLY]信号候选"]'::jsonb);
    IF (v_result->>'contextItemCount')::integer <> 2 OR
       (SELECT count(*) FROM public.interactions WHERE person_id = -927210) <> 1 OR
       (SELECT count(*) FROM public.context_items WHERE person_id = -927210 AND confirmed = false) <> 2 THEN
      RAISE EXCEPTION 'Valid V2 commit did not write expected unconfirmed rows';
    END IF;
    v_before := (SELECT count(*) FROM public.interactions WHERE person_id = -927210);

    BEGIN
      PERFORM public.quick_capture_v2_commit(
        -927210, '[CRM_TEST_ONLY]错误姓名', '[CRM_TEST_ONLY]uid',
        '{"type":"微信","at":"2026-09-27T12:00:00+08:00","summary":"[CRM_TEST_ONLY]互动","rawNote":"[CRM_TEST_ONLY]原话"}'::jsonb,
        '[]'::jsonb, '[]'::jsonb);
      RAISE EXCEPTION 'Mismatched identity was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
      PERFORM public.quick_capture_v2_commit(
        -927210, '[CRM_TEST_ONLY]V2人物', '[CRM_TEST_ONLY]uid',
        '{"type":"微信","at":"2026-09-27T12:00:00+08:00","summary":"[CRM_TEST_ONLY]互动","rawNote":"[CRM_TEST_ONLY]原话"}'::jsonb,
        '[{"forged":"fact"}]'::jsonb, '[]'::jsonb);
      RAISE EXCEPTION 'Invalid Fact candidate was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    IF (SELECT count(*) FROM public.interactions WHERE person_id = -927210) <> v_before OR
       (SELECT count(*) FROM public.context_items WHERE person_id = -927210) <> 2 THEN
      RAISE EXCEPTION 'A rejected V2 write left partial rows';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_MARKED_V2_FIXTURES' USING ERRCODE = 'P7001';
  EXCEPTION WHEN SQLSTATE 'P7001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.persons WHERE id = -927210) OR
     EXISTS (SELECT 1 FROM public.interactions WHERE person_id = -927210) OR
     EXISTS (SELECT 1 FROM public.context_items WHERE person_id = -927210) THEN
    RAISE EXCEPTION 'V2 test fixtures were not rolled back';
  END IF;
END;
$outer$;
