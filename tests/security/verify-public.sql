-- WP 13.6: metadata only. The only application namespace inspected is public.
-- One JSON value works with psql -t -A and CloudBase queryPgDatabase(action=sql).
WITH relations AS (
  SELECT 'relation'::text AS kind, c.relname::text AS name,
    pg_catalog.jsonb_build_object(
      'type', c.relkind::text,
      'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'security_invoker', COALESCE('security_invoker=true' = ANY(c.reloptions), false),
      'privileges', (
        SELECT pg_catalog.jsonb_object_agg(r.rolname, COALESCE((
          SELECT pg_catalog.jsonb_agg(k.privilege_type ORDER BY k.privilege_type)
          FROM (
            SELECT DISTINCT a.privilege_type
            FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
          ) k
          WHERE pg_catalog.has_table_privilege(r.oid, c.oid, k.privilege_type)
        ), '[]'::jsonb))
        FROM pg_catalog.pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      ),
      'policies', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', p.polname, 'command', p.polcmd, 'permissive', p.polpermissive,
          'roles', (SELECT COALESCE(pg_catalog.jsonb_agg(rr.rolname ORDER BY rr.rolname), '[]'::jsonb)
                    FROM pg_catalog.pg_roles rr WHERE rr.oid = ANY(p.polroles)),
          'using_hash', pg_catalog.md5(COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')),
          'check_hash', pg_catalog.md5(COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), ''))
        ) ORDER BY p.polname)
        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid
      ), '[]'::jsonb)
    ) AS detail
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
), sequences AS (
  SELECT 'sequence'::text AS kind, c.relname::text AS name,
    pg_catalog.jsonb_build_object(
      'anon_usage', pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE'),
      'anon_read', pg_catalog.has_sequence_privilege('anon', c.oid, 'SELECT'),
      'authenticated_usage', pg_catalog.has_sequence_privilege('authenticated', c.oid, 'USAGE'),
      'authenticated_read', pg_catalog.has_sequence_privilege('authenticated', c.oid, 'SELECT'),
      'service_usage', pg_catalog.has_sequence_privilege('service_role', c.oid, 'USAGE')
    ) AS detail
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
), routines AS (
  SELECT 'routine'::text AS kind,
    (p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text AS name,
    pg_catalog.jsonb_build_object(
      'security_definer', p.prosecdef,
      'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_execute', pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) AS detail
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)
SELECT pg_catalog.jsonb_build_object(
  'schema', 'public',
  'objects', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', x.kind, 'name', x.name, 'detail', x.detail)
                              ORDER BY x.kind, x.name)
              FROM (SELECT * FROM relations UNION ALL SELECT * FROM sequences UNION ALL SELECT * FROM routines) x)
) AS snapshot;
