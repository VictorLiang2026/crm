-- Read-only. Confirm environment crm-d1gkae8ddc930d151 before execution.
-- No application rows, no schema outside public, no writes.
SELECT c.relname AS object_name, c.relkind AS object_kind,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       c.reloptions AS options,
       CASE WHEN c.relkind = 'v' THEN pg_catalog.pg_get_viewdef(c.oid, true) END AS view_definition,
       c.relacl::text AS explicit_acl,
       (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
           'name', p.polname, 'command', p.polcmd, 'permissive', p.polpermissive,
           'roles', p.polroles::text,
           'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
           'check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)) ORDER BY p.polname)
        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
ORDER BY c.relkind, c.relname;
