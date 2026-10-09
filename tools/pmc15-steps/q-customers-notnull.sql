SELECT to_jsonb(array_agg(column_name ORDER BY ordinal_position)) AS customers_required
FROM information_schema.columns
WHERE table_schema='public' AND table_name='customers'
  AND is_nullable='NO' AND column_default IS NULL;
