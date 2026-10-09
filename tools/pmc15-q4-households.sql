-- PMC-15 q4: households / household_members live state
WITH h AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE deleted_at IS NULL) AS active,
         count(*) FILTER (WHERE deleted_at IS NOT NULL) AS softdeleted
  FROM public.households
), m AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE deleted_at IS NULL) AS active,
         count(*) FILTER (WHERE deleted_at IS NOT NULL) AS softdeleted
  FROM public.household_members
), active_h AS (
  SELECT count(*) AS orphan_active_households
  FROM public.households hh
  LEFT JOIN public.persons p ON p.id=hh.anchor_person_id
  WHERE hh.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NOT NULL)
), active_m AS (
  SELECT count(*) AS orphan_active_members,
         count(*) FILTER (WHERE p.deleted_at IS NOT NULL) AS members_on_deleted_persons
  FROM public.household_members hm
  JOIN public.households hh ON hh.id=hm.household_id
  LEFT JOIN public.persons p ON p.id=hm.person_id
  WHERE hm.deleted_at IS NULL AND hh.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NOT NULL)
), anchor_as_member AS (
  -- anchor listed as member in own household
  SELECT count(*) AS n FROM public.households hh
  JOIN public.household_members hm ON hm.household_id=hh.id AND hm.person_id=hh.anchor_person_id
  WHERE hh.deleted_at IS NULL AND hm.deleted_at IS NULL
), member_roles AS (
  SELECT relationship_to_anchor, count(*) AS n
  FROM public.household_members WHERE deleted_at IS NULL
  GROUP BY relationship_to_anchor ORDER BY n DESC
), cross_household AS (
  -- one active person belonging to >1 active household
  SELECT count(*) AS n FROM (
    SELECT hm.person_id FROM public.household_members hm
    JOIN public.households hh ON hh.id=hm.household_id
    WHERE hm.deleted_at IS NULL AND hh.deleted_at IS NULL
    GROUP BY hm.person_id HAVING count(DISTINCT hm.household_id)>1
  ) x
), sample AS (
  SELECT jsonb_agg(jsonb_build_object(
      'household', hh.id, 'anchor', hh.anchor_person_id,
      'facts', left(COALESCE(hh.important_facts,''),40),
      'members', (SELECT jsonb_agg(jsonb_build_object('person',m2.person_id,'rel',m2.relationship_to_anchor))
                  FROM public.household_members m2 WHERE m2.household_id=hh.id AND m2.deleted_at IS NULL))
    ORDER BY hh.id) AS rows
  FROM public.households hh WHERE hh.deleted_at IS NULL
)
SELECT jsonb_build_object(
  'households', (SELECT to_jsonb(h) FROM h),
  'members', (SELECT to_jsonb(m) FROM m),
  'active_households_orphan_or_deleted_anchor', (SELECT orphan_active_households FROM active_h),
  'active_members_orphan_or_deleted', (SELECT orphan_active_members FROM active_m),
  'active_members_on_deleted_persons', (SELECT members_on_deleted_persons FROM active_m),
  'anchor_listed_as_member', (SELECT n FROM anchor_as_member),
  'members_in_multiple_active_households', (SELECT n FROM cross_household),
  'member_roles', (SELECT jsonb_agg(to_jsonb(r)) FROM member_roles r),
  'sample', (SELECT rows FROM sample)
) AS snapshot;
