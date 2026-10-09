SELECT to_jsonb(array_agg(to_jsonb(t) ORDER BY table_name, ordinal_position)) AS notnull_cols
FROM (
  SELECT c.table_name, c.column_name, c.ordinal_position,
    (c.column_default IS NOT NULL) AS has_default
  FROM information_schema.columns c
  WHERE c.table_schema='public'
    AND c.table_name IN ('persons','recruit_candidates','activity_speakers','activity_participants','activities')
    AND c.is_nullable='NO'
) t;
