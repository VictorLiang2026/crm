-- PMC-14 盘点 Q8：同活动多来源/重复参与者检查（只读，无 PII；activity_id 与计数可输出）
WITH alive AS (
  SELECT ap.id, ap.activity_id, ap.person_type, ap.person_id, ap.canonical_person_id, ap.status, ap.participant_role
  FROM public.activity_participants ap
  WHERE ap.deleted_at IS NULL
),
resolved AS (
  SELECT a.*,
    COALESCE(
      a.canonical_person_id,
      CASE WHEN a.person_type = 'customer' THEN
        (SELECT x.id FROM public.persons x WHERE x.legacy_customer_id = a.person_id AND x.deleted_at IS NULL)
      WHEN a.person_type = 'speaker' THEN
        (SELECT x.id FROM public.persons x JOIN public.activity_speakers s ON s.person_id = x.id
          WHERE s.id = a.person_id AND x.deleted_at IS NULL)
      WHEN a.person_type = 'person' THEN a.person_id
      END
    ) AS resolved_person
  FROM alive a
)
SELECT r.activity_id,
  count(*)::int AS alive_rows,
  count(*) FILTER (WHERE r.person_type = 'customer')::int AS n_customer,
  count(*) FILTER (WHERE r.person_type = 'recruit')::int AS n_recruit,
  count(*) FILTER (WHERE r.person_type = 'speaker')::int AS n_speaker,
  count(*) FILTER (WHERE r.person_type = 'person')::int AS n_person,
  count(*) FILTER (WHERE r.resolved_person IS NOT NULL)::int AS n_resolved,
  count(DISTINCT r.resolved_person)::int AS distinct_resolved
FROM resolved r
GROUP BY r.activity_id
HAVING count(*) > 1 OR count(*) FILTER (WHERE r.resolved_person IS NULL) > 0
ORDER BY r.activity_id;
