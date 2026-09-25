-- Run each SELECT separately through the read-only CloudBase PG query tool.
-- All business objects are explicitly scoped to public.

SELECT table_name, column_name, data_type, is_nullable, is_identity,
       numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ai_tasks', 'ai_runs', 'ai_results')
ORDER BY table_name, ordinal_position;

SELECT c.relname, c.relrowsecurity, c.relacl::text AS acl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('ai_tasks', 'ai_runs', 'ai_results')
ORDER BY c.relname;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ai_tasks', 'ai_runs', 'ai_results')
ORDER BY tablename;

SELECT tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ai_tasks', 'ai_runs', 'ai_results')
ORDER BY tablename, indexname;

SELECT c.relname, con.conname, con.contype,
       pg_catalog.pg_get_constraintdef(con.oid) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('ai_tasks', 'ai_runs', 'ai_results')
  AND con.contype IN ('f', 'u')
ORDER BY c.relname, con.conname;

SELECT (SELECT count(*) FROM public.ai_tasks) AS tasks,
       (SELECT count(*) FROM public.ai_runs) AS runs,
       (SELECT count(*) FROM public.ai_results) AS results;
