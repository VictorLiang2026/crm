SELECT dep.refobjid::regclass AS dependent_object,
       dep.refobjsubid AS col_num,
       dep.deptype,
       cl.relname AS dep_table,
       n.nspname AS dep_schema
FROM pg_depend dep
JOIN pg_attribute a ON a.attrelid = dep.objid AND a.attnum = dep.objsubid
JOIN pg_class cl ON cl.oid = dep.refobjid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE a.attrelid = 'public.persons'::regclass
  AND a.attname = 'legacy_customer_id'
  AND dep.refobjid <> dep.objid
ORDER BY cl.relname;
