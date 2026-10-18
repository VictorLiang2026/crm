-- PC36/PMC18: bounded daily metric collection for the anon Cloud Function PG channel.
-- No person details or caller-provided SQL/payloads are accepted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.pmc18_collect_once_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz;
  v_prior_at timestamptz;
  v_snapshot jsonb;
  v_key text;
  v_count integer;
  v_distinct_count integer;
BEGIN
  -- The fixed lock serializes all callers, including a timer and a manual invoke.
  PERFORM pg_catalog.pg_advisory_xact_lock(180018, 1);
  v_now := clock_timestamp();

  SELECT o.observed_at INTO v_prior_at
  FROM public.pmc18_observations AS o
  WHERE o.metric = 'customers_without_person'
    AND (o.observed_at AT TIME ZONE 'Asia/Shanghai')::date =
        (v_now AT TIME ZONE 'Asia/Shanghai')::date
  ORDER BY o.observed_at DESC, o.id DESC LIMIT 1;
  IF FOUND THEN
    SELECT count(*)::integer, count(DISTINCT o.metric)::integer
      INTO v_count, v_distinct_count
    FROM public.pmc18_observations AS o WHERE o.observed_at = v_prior_at
      AND o.metric IN (
        'customers_without_person', 'recruits_without_person', 'field_drift_rows',
        'duplicate_person_groups', 'orphan_recruit_person_id',
        'orphan_opportunity_person_id', 'orphan_participant_person_id',
        'orphan_interaction_person_id', 'orphan_followup_customer_id',
        'orphan_gift_customer_id', 'orphan_product_customer_id',
        'person_alive_customer_deleted', 'person_deleted_customer_alive',
        'duplicate_role_rows', 'persons_without_role', 'count_persons',
        'count_customers', 'count_recruit_candidates',
        'count_activity_participants', 'count_opportunities');
    IF v_count <> 20 OR v_distinct_count <> 20 THEN
      RAISE EXCEPTION 'PMC18 daily observation is incomplete' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('ok', true, 'reused', true,
      'collectedAt', v_prior_at, 'metrics', v_count);
  END IF;

  v_snapshot := public.pmc18_collect_metrics();
  IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object' OR
     v_snapshot->>'version' IS DISTINCT FROM 'pmc18-metrics-v1' OR
     v_snapshot->>'environment' IS DISTINCT FROM 'crm-d1gkae8ddc930d151' THEN
    RAISE EXCEPTION 'Invalid PMC18 metric snapshot' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'mappings.customers_without_person', 'mappings.recruits_without_person',
    'field_drift.drift_rows', 'duplicate_persons.dup_groups',
    'orphans.recruit_person_id', 'orphans.opportunity_person_id',
    'orphans.participant_person_id', 'orphans.interaction_person_id',
    'orphans.followup_customer_id', 'orphans.gift_customer_id',
    'orphans.product_customer_id',
    'softdelete_cross.person_alive_customer_deleted',
    'softdelete_cross.person_deleted_customer_alive',
    'roles.duplicate_role_rows', 'no_role.no_role',
    'counts.persons.total', 'counts.customers.total',
    'counts.recruit_candidates.total', 'counts.activity_participants.total',
    'counts.opportunities.total'
  ] LOOP
    IF jsonb_typeof(v_snapshot #> string_to_array(v_key, '.')) IS DISTINCT FROM 'number'
       OR ((v_snapshot #>> string_to_array(v_key, '.')) ~ '^[0-9]+$') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Invalid PMC18 metric: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  WITH inserted AS (
    INSERT INTO public.pmc18_observations(observed_at, metric, value, level, detail)
    SELECT v_now, metrics.metric, metrics.value, metrics.level, metrics.detail
    FROM (VALUES
      ('customers_without_person', v_snapshot #>> '{mappings,customers_without_person}',
        CASE WHEN (v_snapshot #>> '{mappings,customers_without_person}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('recruits_without_person', v_snapshot #>> '{mappings,recruits_without_person}',
        CASE WHEN (v_snapshot #>> '{mappings,recruits_without_person}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('field_drift_rows', v_snapshot #>> '{field_drift,drift_rows}',
        CASE WHEN (v_snapshot #>> '{field_drift,drift_rows}')::numeric > 0 THEN 'warning' ELSE 'info' END, NULL::jsonb),
      ('duplicate_person_groups', v_snapshot #>> '{duplicate_persons,dup_groups}',
        CASE WHEN (v_snapshot #>> '{duplicate_persons,dup_groups}')::numeric > 0 THEN 'warning' ELSE 'info' END, NULL::jsonb),
      ('orphan_recruit_person_id', v_snapshot #>> '{orphans,recruit_person_id}',
        CASE WHEN (v_snapshot #>> '{orphans,recruit_person_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_opportunity_person_id', v_snapshot #>> '{orphans,opportunity_person_id}',
        CASE WHEN (v_snapshot #>> '{orphans,opportunity_person_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_participant_person_id', v_snapshot #>> '{orphans,participant_person_id}',
        CASE WHEN (v_snapshot #>> '{orphans,participant_person_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_interaction_person_id', v_snapshot #>> '{orphans,interaction_person_id}',
        CASE WHEN (v_snapshot #>> '{orphans,interaction_person_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_followup_customer_id', v_snapshot #>> '{orphans,followup_customer_id}',
        CASE WHEN (v_snapshot #>> '{orphans,followup_customer_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_gift_customer_id', v_snapshot #>> '{orphans,gift_customer_id}',
        CASE WHEN (v_snapshot #>> '{orphans,gift_customer_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('orphan_product_customer_id', v_snapshot #>> '{orphans,product_customer_id}',
        CASE WHEN (v_snapshot #>> '{orphans,product_customer_id}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('person_alive_customer_deleted', v_snapshot #>> '{softdelete_cross,person_alive_customer_deleted}',
        CASE WHEN (v_snapshot #>> '{softdelete_cross,person_alive_customer_deleted}')::numeric > 0 THEN 'warning' ELSE 'info' END, NULL::jsonb),
      ('person_deleted_customer_alive', v_snapshot #>> '{softdelete_cross,person_deleted_customer_alive}',
        CASE WHEN (v_snapshot #>> '{softdelete_cross,person_deleted_customer_alive}')::numeric > 0 THEN 'warning' ELSE 'info' END, NULL::jsonb),
      ('duplicate_role_rows', v_snapshot #>> '{roles,duplicate_role_rows}',
        CASE WHEN (v_snapshot #>> '{roles,duplicate_role_rows}')::numeric > 0 THEN 'critical' ELSE 'info' END, NULL::jsonb),
      ('persons_without_role', v_snapshot #>> '{no_role,no_role}',
        CASE WHEN (v_snapshot #>> '{no_role,no_role}')::numeric > 0 THEN 'warning' ELSE 'info' END, NULL::jsonb),
      ('count_persons', v_snapshot #>> '{counts,persons,total}', 'info', v_snapshot #> '{counts,persons}'),
      ('count_customers', v_snapshot #>> '{counts,customers,total}', 'info', v_snapshot #> '{counts,customers}'),
      ('count_recruit_candidates', v_snapshot #>> '{counts,recruit_candidates,total}', 'info', v_snapshot #> '{counts,recruit_candidates}'),
      ('count_activity_participants', v_snapshot #>> '{counts,activity_participants,total}', 'info', v_snapshot #> '{counts,activity_participants}'),
      ('count_opportunities', v_snapshot #>> '{counts,opportunities,total}', 'info', v_snapshot #> '{counts,opportunities}')
    ) AS metrics(metric, value, level, detail)
    RETURNING id
  ) SELECT count(*)::integer INTO v_count FROM inserted;
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'PMC18 observation write failed' USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object('ok', true, 'reused', false,
    'collectedAt', v_now, 'metrics', v_count,
    'summary', jsonb_build_object(
      'customers_without_person', v_snapshot #> '{mappings,customers_without_person}',
      'recruits_without_person', v_snapshot #> '{mappings,recruits_without_person}',
      'field_drift', v_snapshot #> '{field_drift,drift_rows}',
      'duplicate_persons', v_snapshot #> '{duplicate_persons,dup_groups}',
      'orphans', v_snapshot->'orphans',
      'persons_without_role', v_snapshot #> '{no_role,no_role}'));
END;
$function$;

REVOKE ALL ON FUNCTION public.pmc18_collect_once_v1() FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pmc18_collect_once_v1() TO anon;
COMMENT ON FUNCTION public.pmc18_collect_once_v1() IS
  'Fixed no-argument PMC18 snapshot: one atomic 20-metric batch per Asia/Shanghai day.';
COMMIT;
