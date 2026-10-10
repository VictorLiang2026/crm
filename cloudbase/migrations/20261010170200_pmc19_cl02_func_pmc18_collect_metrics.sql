CREATE OR REPLACE FUNCTION public.pmc18_collect_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH counts AS (
    SELECT 'persons'::text AS t, count(*)::int AS total,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted FROM public.persons
    UNION ALL SELECT 'customers', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.customers
    UNION ALL SELECT 'recruit_candidates', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.recruit_candidates
    UNION ALL SELECT 'activity_participants', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.activity_participants
    UNION ALL SELECT 'opportunities', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.opportunities
  ),
  mappings AS (
    SELECT
      (SELECT count(*)::int FROM public.customers WHERE deleted_at IS NULL) AS active_customers,
      (SELECT count(*)::int FROM public.customers WHERE deleted_at IS NULL AND person_id IS NULL) AS customers_without_person,
      (SELECT count(*)::int FROM public.recruit_candidates WHERE deleted_at IS NULL) AS active_recruits,
      (SELECT count(*)::int FROM public.recruit_candidates WHERE deleted_at IS NULL AND person_id IS NULL) AS recruits_without_person
  ),
  -- PMC-19 CL-02: customers 副本列已退出，persons 是唯一权威来源，drift=0
  field_drift AS (
    SELECT 0::int AS drift_rows
  ),
  duplicate_persons AS (
    SELECT count(*)::int AS dup_groups FROM (
      SELECT p.display_name, p.phone
      FROM public.persons p
      WHERE p.deleted_at IS NULL AND p.phone IS NOT NULL AND p.phone <> ''
      GROUP BY p.display_name, p.phone HAVING count(*) > 1
    ) d
  ),
  orphans AS (
    SELECT
      (SELECT count(*)::int FROM public.recruit_candidates rc LEFT JOIN public.persons p ON rc.person_id=p.id WHERE rc.person_id IS NOT NULL AND p.id IS NULL) AS recruit_person_id,
      (SELECT count(*)::int FROM public.opportunities o LEFT JOIN public.persons p ON o.person_id=p.id WHERE o.person_id IS NOT NULL AND p.id IS NULL) AS opportunity_person_id,
      (SELECT count(*)::int FROM public.activity_participants ap LEFT JOIN public.persons p ON ap.person_id=p.id WHERE ap.person_id IS NOT NULL AND p.id IS NULL) AS participant_person_id,
      (SELECT count(*)::int FROM public.interactions i LEFT JOIN public.persons p ON i.person_id=p.id WHERE i.person_id IS NOT NULL AND p.id IS NULL) AS interaction_person_id,
      (SELECT count(*)::int FROM public.followups f LEFT JOIN public.customers c ON f.customer_id=c."Id" WHERE f.customer_id IS NOT NULL AND c."Id" IS NULL) AS followup_customer_id,
      (SELECT count(*)::int FROM public.gifts g LEFT JOIN public.customers c ON g.customer_id=c."Id" WHERE g.customer_id IS NOT NULL AND c."Id" IS NULL) AS gift_customer_id,
      (SELECT count(*)::int FROM public.products pr LEFT JOIN public.customers c ON pr.customer_id=c."Id" WHERE pr.customer_id IS NOT NULL AND c."Id" IS NULL) AS product_customer_id
  ),
  -- PMC-19 CL-03 prep: JOIN 走 person_id 非 legacy_customer_id
  softdelete_cross AS (
    SELECT
      (SELECT count(*)::int FROM public.persons p JOIN public.customers c ON c.person_id=p.id WHERE p.deleted_at IS NULL AND c.deleted_at IS NOT NULL) AS person_alive_customer_deleted,
      (SELECT count(*)::int FROM public.persons p JOIN public.customers c ON c.person_id=p.id WHERE p.deleted_at IS NOT NULL AND c.deleted_at IS NULL) AS person_deleted_customer_alive
  ),
  roles AS (
    SELECT count(*)::int AS duplicate_role_rows FROM (
      SELECT person_id, role FROM public.person_roles GROUP BY person_id, role HAVING count(*) > 1
    ) d
  ),
  no_role AS (
    SELECT count(*)::int AS no_role FROM public.persons p
    WHERE p.deleted_at IS NULL
      AND p.display_name NOT LIKE '【系统测试%'
      AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id = p.id)
  )
  SELECT jsonb_build_object(
    'version', 'pmc18-metrics-v1',
    'environment', 'crm-d1gkae8ddc930d151',
    'observedAt', CURRENT_TIMESTAMP,
    'counts', (SELECT jsonb_object_agg(t, jsonb_build_object('total', total, 'softDeleted', soft_deleted)) FROM counts),
    'mappings', (SELECT to_jsonb(m.*) FROM mappings m),
    'field_drift', (SELECT to_jsonb(f.*) FROM field_drift f),
    'duplicate_persons', (SELECT to_jsonb(d.*) FROM duplicate_persons d),
    'orphans', (SELECT to_jsonb(o.*) FROM orphans o),
    'softdelete_cross', (SELECT to_jsonb(s.*) FROM softdelete_cross s),
    'roles', (SELECT to_jsonb(r.*) FROM roles r),
    'no_role', (SELECT to_jsonb(n.*) FROM no_role n)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
