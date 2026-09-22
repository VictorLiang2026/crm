-- Metadata only. Inspect dependencies of public objects; never follow an external dependency.
SELECT v.relname AS public_view, d.refobjid AS referenced_oid,
       CASE WHEN n.nspname IN ('public','pg_catalog') THEN n.nspname ELSE 'OUT_OF_SCOPE_STOP' END AS dependency_scope,
       CASE WHEN n.nspname IN ('public','pg_catalog') THEN c.relname ELSE NULL END AS referenced_object
FROM pg_catalog.pg_class v
JOIN pg_catalog.pg_namespace vn ON vn.oid = v.relnamespace AND vn.nspname = 'public'
JOIN pg_catalog.pg_rewrite rw ON rw.ev_class = v.oid
JOIN pg_catalog.pg_depend d ON d.objid = rw.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass
JOIN pg_catalog.pg_class c ON c.oid = d.refobjid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE v.relkind = 'v' AND c.oid <> v.oid
GROUP BY v.relname, d.refobjid, n.nspname, c.relname
ORDER BY v.relname, d.refobjid;
