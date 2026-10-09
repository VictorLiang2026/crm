-- PMC-15 q3: relationships live state: counts, types, direction pairs, endpoint validity
WITH base AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE deleted_at IS NULL) AS active,
         count(*) FILTER (WHERE deleted_at IS NOT NULL) AS softdeleted,
         count(*) FILTER (WHERE deleted_at IS NULL AND introduced_by_person_id IS NOT NULL) AS active_with_introducer,
         count(*) FILTER (WHERE from_person_id=to_person_id) AS self_relations,
         count(DISTINCT relationship_type) FILTER (WHERE deleted_at IS NULL) AS active_type_kinds
  FROM public.relationships
), types AS (
  SELECT relationship_type, relationship_stage, count(*) AS n
  FROM public.relationships WHERE deleted_at IS NULL
  GROUP BY relationship_type, relationship_stage ORDER BY n DESC
), bad_endpoint AS (
  SELECT count(*) AS n FROM public.relationships r
  LEFT JOIN public.persons p1 ON p1.id=r.from_person_id
  LEFT JOIN public.persons p2 ON p2.id=r.to_person_id
  WHERE r.deleted_at IS NULL AND (p1.id IS NULL OR p2.id IS NULL)
), endpoint_deleted AS (
  SELECT count(*) AS n FROM public.relationships r
  JOIN public.persons p1 ON p1.id=r.from_person_id
  JOIN public.persons p2 ON p2.id=r.to_person_id
  WHERE r.deleted_at IS NULL AND (p1.deleted_at IS NOT NULL OR p2.deleted_at IS NOT NULL)
), reverse_pairs AS (
  SELECT count(*) AS n FROM public.relationships a
  JOIN public.relationships b
    ON b.to_person_id=a.from_person_id AND b.from_person_id=a.to_person_id
   AND b.relationship_type=a.relationship_type AND b.deleted_at IS NULL
  WHERE a.deleted_at IS NULL AND a.id < b.id
), dup_softdeleted AS (
  SELECT count(*) AS n FROM (
    SELECT from_person_id, to_person_id, relationship_type, count(*) AS c
    FROM public.relationships
    WHERE deleted_at IS NOT NULL
    GROUP BY 1,2,3 HAVING count(*)>1
  ) d
), sample AS (
  SELECT jsonb_agg(to_jsonb(s)) AS rows FROM (
    SELECT id, from_person_id AS "from", to_person_id AS "to",
           relationship_type AS type, relationship_stage AS stage,
           introduced_by_person_id AS introducer, deleted_at IS NOT NULL AS deleted
    FROM public.relationships ORDER BY id LIMIT 20
  ) s
)
SELECT jsonb_build_object(
  'counts', (SELECT to_jsonb(base) FROM base),
  'active_types', (SELECT jsonb_agg(to_jsonb(t)) FROM types t),
  'active_bad_endpoints', (SELECT n FROM bad_endpoint),
  'active_endpoints_on_deleted_persons', (SELECT n FROM endpoint_deleted),
  'active_reverse_pairs', (SELECT n FROM reverse_pairs),
  'softdeleted_duplicate_groups', (SELECT n FROM dup_softdeleted),
  'sample', (SELECT rows FROM sample)
) AS snapshot;
