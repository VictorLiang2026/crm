-- [CRM_TEST_ONLY] isolated 2099-01 fixture. The subtransaction always rolls back.
-- Run only after confirming the month is empty in public.recruit_goals.
DO $test$
DECLARE
  v_first_id bigint;
  v_first_ctid tid;
  v_first_created timestamptz;
  v_first_updated timestamptz;
  v_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.recruit_goals WHERE goal_month = DATE '2099-01-01') THEN
    RAISE EXCEPTION 'Test month is occupied';
  END IF;

  BEGIN
    v_result := public.crm_recruit_goals_save_v1('2099-01',
      '{"新增人才":5,"互动暖客":2}'::jsonb, '[CRM_TEST_ONLY]');
    IF v_result <> '{"ok":true,"inserted":2}'::jsonb OR
       (SELECT count(*) FROM public.recruit_goals WHERE goal_month = DATE '2099-01-01') <> 2 THEN
      RAISE EXCEPTION 'Initial atomic save failed';
    END IF;

    SELECT id, ctid, created_at, updated_at
      INTO v_first_id, v_first_ctid, v_first_created, v_first_updated
    FROM public.recruit_goals
    WHERE goal_month = DATE '2099-01-01' AND stage = '新增人才';

    PERFORM public.crm_recruit_goals_save_v1('2099-01',
      '{"新增人才":5,"互动暖客":2}'::jsonb, '[CRM_TEST_ONLY]');
    IF EXISTS (
      SELECT 1 FROM public.recruit_goals
      WHERE goal_month = DATE '2099-01-01' AND stage = '新增人才'
        AND (id <> v_first_id OR ctid <> v_first_ctid
             OR created_at <> v_first_created OR updated_at <> v_first_updated)
    ) THEN
      RAISE EXCEPTION 'Identical retry changed the existing row';
    END IF;

    v_result := public.crm_recruit_goals_save_v1('2099-01',
      '{"新增人才":5,"互动暖客":0,"初次面谈":3}'::jsonb, '[CRM_TEST_ONLY]');
    IF v_result <> '{"ok":true,"inserted":2}'::jsonb OR EXISTS (
      SELECT 1 FROM public.recruit_goals
      WHERE goal_month = DATE '2099-01-01' AND stage = '互动暖客'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recruit_goals
      WHERE goal_month = DATE '2099-01-01' AND stage = '初次面谈' AND target_count = 3
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recruit_goals
      WHERE id = v_first_id AND target_count = 5
    ) THEN
      RAISE EXCEPTION 'Replacement semantics or row identity failed';
    END IF;

    BEGIN
      PERFORM public.crm_recruit_goals_save_v1('2099-01',
        '{"新增人才":7,"互动暖客":"bad"}'::jsonb, '[CRM_TEST_ONLY]');
      RAISE EXCEPTION 'Invalid input was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;
    IF (SELECT count(*) FROM public.recruit_goals
        WHERE goal_month = DATE '2099-01-01') <> 2 THEN
      RAISE EXCEPTION 'Invalid input changed saved goals';
    END IF;

    PERFORM public.crm_recruit_goals_save_v1('2099-01', '{}'::jsonb,
      '[CRM_TEST_ONLY]');
    IF EXISTS (SELECT 1 FROM public.recruit_goals
               WHERE goal_month = DATE '2099-01-01') THEN
      RAISE EXCEPTION 'All-zero save did not clear the month';
    END IF;

    PERFORM public.crm_recruit_goals_save_v1('2099-01',
      '{"新增人才":1}'::jsonb, '[CRM_TEST_ONLY]');
    RAISE EXCEPTION 'Rollback test fixture' USING ERRCODE = 'PT001';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.recruit_goals
             WHERE goal_month = DATE '2099-01-01') THEN
    RAISE EXCEPTION 'Rolled-back test fixture leaked';
  END IF;
END $test$;
