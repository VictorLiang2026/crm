SELECT
  'TRIGGER' AS type,
  t.tgname AS name,
  c.relname AS table_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND (pg_get_triggerdef(t.oid) ILIKE '%legacy_customer_id%'
       OR c.relname = 'persons')

UNION ALL

SELECT
  'CONSTRAINT' AS type,
  con.conname AS name,
  cl.relname AS table_name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class cl ON cl.oid = con.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND pg_get_constraintdef(con.oid) ILIKE '%legacy_customer_id%'

UNION ALL

SELECT
  'INDEX' AS type,
  ic.relname AS name,
  tbl.relname AS table_name,
  pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class ic ON ic.oid = ix.indexrelid
JOIN pg_class tbl ON tbl.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%legacy_customer_id%';
