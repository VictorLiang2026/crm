-- PMC-03 migration-check.sql
-- Read-only WITH -> single JSON snapshot column. No PII (no name/phone/wechat/notes values).
-- Run via: node tools/migration-check.cjs --out <path>
-- Safety: SELECT/WITH only; pg-readonly.cjs rejects DDL/DML/multi-statement.
WITH counts AS (
  SELECT 'persons'::text AS t, count(*)::int AS total,
         count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted FROM public.persons
  UNION ALL SELECT 'customers', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.customers
  UNION ALL SELECT 'recruit_candidates', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.recruit_candidates
  UNION ALL SELECT 'activity_speakers', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.activity_speakers
  UNION ALL SELECT 'activity_participants', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.activity_participants
  UNION ALL SELECT 'opportunities', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.opportunities
  UNION ALL SELECT 'relationships', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.relationships
),
mappings AS (
  SELECT
    (SELECT count(*)::int FROM public.persons p
       JOIN public.customers c ON p.legacy_customer_id = c."Id"
       WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL) AS legacy_matched,
    (SELECT count(*)::int FROM public.customers c
       LEFT JOIN public.persons p ON p.legacy_customer_id = c."Id"
       WHERE c.deleted_at IS NULL AND p.id IS NULL) AS customers_without_person,
    NULL::int AS customers_with_person_id,
    NULL::int AS customer_person_unique_violations
),
orphans AS (
  SELECT
    (SELECT count(*)::int FROM public.recruit_candidates rc
       LEFT JOIN public.customers c ON rc.customer_id = c."Id"
       WHERE rc.customer_id IS NOT NULL AND c."Id" IS NULL) AS recruit_customer_id,
    (SELECT count(*)::int FROM public.recruit_candidates rc
       LEFT JOIN public.persons p ON rc.person_id = p.id
       WHERE rc.person_id IS NOT NULL AND p.id IS NULL) AS recruit_person_id,
    (SELECT count(*)::int FROM public.opportunities o
       LEFT JOIN public.customers c ON o.customer_id = c."Id"
       WHERE o.customer_id IS NOT NULL AND c."Id" IS NULL) AS opportunity_customer_id,
    (SELECT count(*)::int FROM public.opportunities o
       LEFT JOIN public.persons p ON o.person_id = p.id
       WHERE o.person_id IS NOT NULL AND p.id IS NULL) AS opportunity_person_id,
    (SELECT count(*)::int FROM public.followups f
       LEFT JOIN public.customers c ON f.customer_id = c."Id"
       WHERE f.customer_id IS NOT NULL AND c."Id" IS NULL) AS followup_customer_id,
    (SELECT count(*)::int FROM public.gifts g
       LEFT JOIN public.customers c ON g.customer_id = c."Id"
       WHERE g.customer_id IS NOT NULL AND c."Id" IS NULL) AS gift_customer_id,
    (SELECT count(*)::int FROM public.photos ph
       LEFT JOIN public.customers c ON ph.customer_id = c."Id"
       WHERE ph.customer_id IS NOT NULL AND c."Id" IS NULL) AS photo_customer_id,
    (SELECT count(*)::int FROM public.products pr
       LEFT JOIN public.customers c ON pr.customer_id = c."Id"
       WHERE pr.customer_id IS NOT NULL AND c."Id" IS NULL) AS product_customer_id,
    (SELECT count(*)::int FROM public.activity_participants ap
       LEFT JOIN public.persons p ON ap.person_id = p.id
       WHERE ap.person_id IS NOT NULL AND p.id IS NULL) AS participant_person_id,
    (SELECT count(*)::int FROM public.interactions i
       LEFT JOIN public.persons p ON i.person_id = p.id
       WHERE i.person_id IS NOT NULL AND p.id IS NULL) AS interaction_person_id
),
roles AS (
  SELECT count(*)::int AS duplicate_role_rows FROM (
    SELECT person_id, role FROM public.person_roles
    GROUP BY person_id, role HAVING count(*) > 1
  ) d
),
softdelete_cross AS (
  SELECT
    (SELECT count(*)::int FROM public.persons p
       JOIN public.customers c ON p.legacy_customer_id = c."Id"
       WHERE p.deleted_at IS NULL AND c.deleted_at IS NOT NULL) AS person_alive_customer_deleted,
    (SELECT count(*)::int FROM public.persons p
       JOIN public.customers c ON p.legacy_customer_id = c."Id"
       WHERE p.deleted_at IS NOT NULL AND c.deleted_at IS NULL) AS person_deleted_customer_alive
),
nulls AS (
  SELECT
    (SELECT count(*)::int FROM public.persons WHERE display_name IS NULL) AS persons_display_name,
    (SELECT count(*)::int FROM public.persons WHERE phone IS NULL) AS persons_phone,
    (SELECT count(*)::int FROM public.customers WHERE customer_name IS NULL) AS customers_customer_name
),
pagination AS (
  SELECT COALESCE(
    (SELECT string_agg(col, ',' ORDER BY col) FROM (
        SELECT column_name AS col FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers'
        ORDER BY ordinal_position
    ) c),
    '')::text AS customers_columns_fingerprint
),
failures(arr) AS (
  SELECT jsonb_agg(f) FROM (
    SELECT jsonb_build_object('check', 'orphans.recruit_customer_id', 'actual', o.recruit_customer_id, 'expected', 0, 'severity', 'blocker') AS f
      FROM orphans o WHERE o.recruit_customer_id > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'orphans.recruit_person_id', 'actual', o.recruit_person_id, 'expected', 0, 'severity', 'blocker')
      FROM orphans o WHERE o.recruit_person_id > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'orphans.opportunity_person_id', 'actual', o.opportunity_person_id, 'expected', 0, 'severity', 'blocker')
      FROM orphans o WHERE o.opportunity_person_id > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'orphans.participant_person_id', 'actual', o.participant_person_id, 'expected', 0, 'severity', 'blocker')
      FROM orphans o WHERE o.participant_person_id > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'orphans.interaction_person_id', 'actual', o.interaction_person_id, 'expected', 0, 'severity', 'blocker')
      FROM orphans o WHERE o.interaction_person_id > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'roles.duplicate_role_rows', 'actual', r.duplicate_role_rows, 'expected', 0, 'severity', 'blocker')
      FROM roles r WHERE r.duplicate_role_rows > 0
    UNION ALL
    SELECT jsonb_build_object('check', 'mappings.customer_person_unique_violations', 'actual', m.customer_person_unique_violations, 'expected', 0, 'severity', 'blocker')
      FROM mappings m WHERE m.customer_person_unique_violations > 0
  ) failures
)
SELECT jsonb_build_object(
  'version', 'pmc03-v1',
  'schema', 'public',
  'environment', 'crm-d1gkae8ddc930d151',
  'observedAt', CURRENT_TIMESTAMP,
  'counts', (SELECT jsonb_object_agg(t, jsonb_build_object('total', total, 'softDeleted', soft_deleted)) FROM counts),
  'mappings', (SELECT to_jsonb(m.*) FROM mappings m),
  'orphans', (SELECT to_jsonb(o.*) FROM orphans o),
  'roles', (SELECT to_jsonb(r.*) FROM roles r),
  'softdelete_cross', (SELECT to_jsonb(s.*) FROM softdelete_cross s),
  'nulls', (SELECT to_jsonb(n.*) FROM nulls n),
  'pagination', (SELECT to_jsonb(p.*) FROM pagination p),
  'failures', COALESCE((SELECT arr FROM failures), '[]'::jsonb),
  'status', CASE WHEN (SELECT count(*) FROM failures) > 0 THEN 'FAIL' ELSE 'PASS' END
) AS snapshot;
