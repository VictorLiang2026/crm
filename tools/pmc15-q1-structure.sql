-- PMC-15 q1: live structure of the four tables + triggers touching them
WITH cols AS (
  SELECT table_name,
         jsonb_agg(jsonb_build_object(
           'col', column_name, 'type', data_type,
           'nullable', is_nullable, 'default', column_default
         ) ORDER BY ordinal_position) AS columns
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('person_roles','relationships','households','household_members')
  GROUP BY table_name
), cons AS (
  SELECT c.relname AS table_name,
         jsonb_agg(jsonb_build_object('name', con.conname, 'type', con.contype,
                    'def', pg_get_constraintdef(con.oid)) ORDER BY con.conname) AS constraints
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('person_roles','relationships','households','household_members')
  GROUP BY c.relname
), trg AS (
  SELECT tg.tgrelid::regclass::text AS table_name,
         jsonb_agg(jsonb_build_object('trigger', tg.tgname,
                    'fn', p.proname, 'fired', CASE WHEN tg.tgenabled='O' THEN 'enabled' ELSE 'disabled' END)
                   ORDER BY tg.tgname) AS triggers
  FROM pg_trigger tg JOIN pg_proc p ON p.oid=tg.tgfoid
  WHERE NOT tg.tgisinternal
    AND tg.tgrelid IN ('public.person_roles'::regclass,'public.relationships'::regclass,
                       'public.households'::regclass,'public.household_members'::regclass)
  GROUP BY tg.tgrelid
), write_trg AS (
  -- triggers anywhere that write into person_roles
  SELECT jsonb_agg(jsonb_build_object('table', tg.tgrelid::regclass::text, 'trigger', tg.tgname, 'fn', p.proname)
                   ORDER BY tg.tgrelid::regclass::text, tg.tgname) AS triggers_writing_roles
  FROM pg_trigger tg
  JOIN pg_proc p ON p.oid=tg.tgfoid
  JOIN pg_class c ON c.oid=tg.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT tg.tgisinternal AND n.nspname='public'
    AND pg_get_functiondef(p.oid) ILIKE '%person_roles%'
)
SELECT jsonb_build_object(
  'columns', (SELECT jsonb_object_agg(table_name, columns) FROM cols),
  'constraints', (SELECT jsonb_object_agg(table_name, constraints) FROM cons),
  'triggers_on_targets', (SELECT jsonb_object_agg(table_name, triggers) FROM trg),
  'triggers_writing_roles', (SELECT triggers_writing_roles FROM write_trg)
) AS snapshot;
