-- PMC-15 q5: views and DB routines depending on the four tables
WITH targets AS (
  SELECT unnest(ARRAY['person_roles','relationships','households','household_members']) AS t
), views AS (
  SELECT jsonb_agg(jsonb_build_object('view', c.relname, 'sec_invoker',
      COALESCE('security_invoker=true' = ANY(c.reloptions), false)) ORDER BY c.relname) AS rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_depend d ON d.refobjid=c.oid AND d.deptype IN ('n','a')
  JOIN pg_class rc ON rc.oid=d.objid AND rc.relkind IN ('v','m')
  JOIN pg_namespace rn ON rn.oid=rc.relnamespace AND rn.nspname='public'
  WHERE n.nspname='public' AND c.relname IN (SELECT t FROM targets) AND c.relkind='r'
), all_views AS (
  SELECT DISTINCT rc.relname AS view_name
  FROM pg_depend d
  JOIN pg_class rc ON rc.oid=d.objid AND rc.relkind IN ('v','m')
  JOIN pg_namespace rn ON rn.oid=rc.relnamespace AND rn.nspname='public'
  JOIN pg_class c ON c.oid=d.refobjid AND c.relkind IN ('r','v')
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  WHERE c.relname IN (SELECT t FROM targets)
), routines AS (
  SELECT p.proname AS fn,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef AS security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (
      EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace cn ON cn.oid=c.relnamespace
              WHERE d.objid=p.oid AND cn.nspname='public' AND c.relname IN (SELECT t FROM targets))
      OR pg_get_functiondef(p.oid) ~* 'person_roles|household_members|households|relationships'
    )
  ORDER BY p.proname
)
SELECT jsonb_build_object(
  'views_depending', (SELECT jsonb_agg(view_name ORDER BY view_name) FROM all_views),
  'routines_referencing', (SELECT jsonb_agg(jsonb_build_object('fn',fn,'args',args,'secdef',security_definer)) FROM routines)
) AS snapshot;
