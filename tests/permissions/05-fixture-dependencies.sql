-- Read-only guard before creating explicitly marked fixtures.
SELECT 'constraint' AS kind, c.relname AS object_name, k.conname AS name,
       pg_catalog.pg_get_constraintdef(k.oid, true) AS definition,
       CASE WHEN rn.nspname IS NULL OR rn.nspname = 'public' THEN 'public' ELSE 'OUT_OF_SCOPE_STOP' END AS scope
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_class rc ON rc.oid = k.confrelid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('customers','policy_review_reports')
UNION ALL
SELECT 'trigger', c.relname, t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true),
       CASE WHEN pn.nspname = 'public' THEN 'public' ELSE 'OUT_OF_SCOPE_STOP' END
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
WHERE n.nspname='public' AND c.relname IN ('customers','policy_review_reports') AND NOT t.tgisinternal;
