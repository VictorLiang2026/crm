-- Read-only verification. New tables start empty; no Person is created or changed.
SELECT
  (SELECT count(*) FROM public.households) AS household_count,
  (SELECT count(*) FROM public.household_members) AS member_count,
  (SELECT count(*) FROM public.household_members AS m
   LEFT JOIN public.persons AS p ON p.id = m.person_id
   WHERE p.id IS NULL) AS orphan_members,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.households'::regclass) AS households_rls,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.household_members'::regclass) AS members_rls,
  has_table_privilege('anon', 'public.households', 'SELECT') AS anon_households_select,
  has_table_privilege('authenticated', 'public.households', 'SELECT') AS authenticated_households_select,
  has_table_privilege('service_role', 'public.households', 'SELECT') AS service_households_select,
  has_table_privilege('anon', 'public.household_members', 'SELECT') AS anon_members_select,
  has_table_privilege('authenticated', 'public.household_members', 'SELECT') AS authenticated_members_select,
  has_table_privilege('service_role', 'public.household_members', 'SELECT') AS service_members_select,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'households'
          AND indexname = 'households_active_anchor_key') AS unique_active_anchor,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'household_members'
          AND indexname = 'household_members_active_person_key') AS unique_active_member;
