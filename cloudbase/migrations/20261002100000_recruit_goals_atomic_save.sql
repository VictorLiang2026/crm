-- WP 13.3: replace the two-request monthly goal write with one atomic RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regprocedure('public.crm_recruit_goals_save_v1(text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'public.crm_recruit_goals_save_v1 already exists';
  END IF;
END $guard$;

CREATE FUNCTION public.crm_recruit_goals_save_v1(
  p_goal_month text,
  p_goals jsonb,
  p_operator text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_month date;
  v_stage text;
  v_raw text;
  v_count bigint;
  v_stages constant text[] := ARRAY[
    '新增人才', '互动暖客', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入司'
  ];
  v_positive text[] := ARRAY[]::text[];
BEGIN
  IF p_goal_month IS NULL OR p_goal_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    OR p_goals IS NULL OR jsonb_typeof(p_goals) <> 'object' THEN
    RAISE EXCEPTION 'Invalid recruit goal month or goals' USING ERRCODE = '22023';
  END IF;
  v_month := make_date(substr(p_goal_month, 1, 4)::integer,
                       substr(p_goal_month, 6, 2)::integer, 1);

  -- Validate every stage before the first write. Missing or null values mean zero.
  FOREACH v_stage IN ARRAY v_stages LOOP
    v_raw := p_goals ->> v_stage;
    IF v_raw IS NULL THEN CONTINUE; END IF;
    IF v_raw !~ '^[0-9]{1,10}$' THEN
      RAISE EXCEPTION 'Invalid recruit goal count for %', v_stage USING ERRCODE = '22023';
    END IF;
    v_count := v_raw::bigint;
    IF v_count > 2147483647 THEN
      RAISE EXCEPTION 'Recruit goal count exceeds integer range' USING ERRCODE = '22023';
    END IF;
    IF v_count > 0 THEN v_positive := array_append(v_positive, v_stage); END IF;
  END LOOP;

  -- Serialize saves of the same month. A single RPC statement is one PG transaction.
  PERFORM pg_advisory_xact_lock(133, v_month - DATE '2000-01-01');

  -- Match the old replacement semantics, including removal of legacy stage names.
  DELETE FROM public.recruit_goals
  WHERE goal_month = v_month AND stage <> ALL(v_positive);

  FOREACH v_stage IN ARRAY v_positive LOOP
    INSERT INTO public.recruit_goals AS current_goal (goal_month, stage, target_count, operator)
    VALUES (v_month, v_stage, (p_goals ->> v_stage)::integer, p_operator)
    ON CONFLICT (goal_month, stage) DO UPDATE
      SET target_count = EXCLUDED.target_count,
          operator = EXCLUDED.operator,
          updated_at = now()
      WHERE current_goal.target_count IS DISTINCT FROM EXCLUDED.target_count
         OR current_goal.operator IS DISTINCT FROM EXCLUDED.operator;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', cardinality(v_positive));
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_recruit_goals_save_v1(text,jsonb,text)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruit_goals_save_v1(text,jsonb,text)
  TO anon, service_role;

COMMIT;
