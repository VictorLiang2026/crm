-- Read-only verification of the additive public Person role and relationship layer.
SELECT
  (SELECT count(*) FROM public.person_roles) AS role_count,
  (SELECT count(*) FROM public.person_roles WHERE role = 'customer') AS customer_roles,
  (SELECT count(*) FROM public.person_roles WHERE role = 'recruit') AS recruit_roles,
  (SELECT count(*) FROM public.person_roles WHERE role = 'speaker') AS speaker_roles,
  (SELECT count(*) FROM public.person_roles WHERE role = 'participant') AS participant_roles,
  (SELECT count(*) FROM public.person_roles AS r
   LEFT JOIN public.persons AS p ON p.id = r.person_id
   WHERE p.id IS NULL) AS orphan_roles,
  (SELECT count(*) FROM public.relationships) AS relationship_count,
  (SELECT count(*) FROM public.relationships AS r
   LEFT JOIN public.persons AS source ON source.id = r.from_person_id
   LEFT JOIN public.persons AS target ON target.id = r.to_person_id
   WHERE source.id IS NULL OR target.id IS NULL) AS orphan_relationships,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.person_roles'::regclass) AS roles_rls,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.relationships'::regclass) AS relationships_rls,
  has_table_privilege('anon', 'public.person_roles', 'SELECT') AS anon_roles_select,
  has_table_privilege('authenticated', 'public.person_roles', 'SELECT') AS authenticated_roles_select,
  has_table_privilege('service_role', 'public.person_roles', 'SELECT') AS service_roles_select,
  has_table_privilege('anon', 'public.relationships', 'SELECT') AS anon_relationships_select,
  has_table_privilege('authenticated', 'public.relationships', 'SELECT') AS authenticated_relationships_select,
  has_table_privilege('service_role', 'public.relationships', 'SELECT') AS service_relationships_select,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
          AND tablename = 'relationships' AND indexname = 'relationships_directed_active_key'
          AND indexdef LIKE '%(from_person_id, to_person_id, relationship_type)%'
          AND indexdef LIKE '%deleted_at IS NULL%') AS directed_active_unique_index,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'customers' AND column_name = 'customer_stage') AS customer_stage_preserved,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'recruit_candidates' AND column_name = 'stage') AS recruit_stage_preserved,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'activity_speakers' AND column_name = 'relationship_stage') AS speaker_stage_preserved;
