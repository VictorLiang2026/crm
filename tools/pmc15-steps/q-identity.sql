SELECT to_jsonb(array_agg(to_jsonb(t) ORDER BY table_name)) AS identity_cols
FROM (
  SELECT table_name, column_name, is_identity, identity_generation, column_default
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('persons','recruit_candidates','activity_speakers','activity_participants','activities','relationships','person_roles','customers')
    AND (is_identity='YES' OR column_default IS NOT NULL)
    AND column_name IN ('id','Id','created_at','updated_at')
) t;
