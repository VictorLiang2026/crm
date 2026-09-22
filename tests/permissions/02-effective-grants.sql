-- Read-only effective privileges (including inherited/PUBLIC grants).
-- Privileges alone do not prove RLS visibility or gateway authorization.
SELECT c.relname AS object_name, r.rolname AS role_name,
       r.rolsuper AS is_superuser, r.rolbypassrls AS bypass_rls,
       pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
       (SELECT pg_catalog.json_object_agg(a.privilege_type,
            pg_catalog.has_table_privilege(r.oid, c.oid, a.privilege_type))
        FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', c.relowner)) a) AS effective_privileges
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY c.relname, r.rolname;
