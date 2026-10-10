SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('activity_speakers','activity_participants','recruit_candidates',
                     'followups','gifts','photos','products','relationships',
                     'household_members','interactions','actions','ai_recommendations','ocr_records')
  AND (column_name LIKE '%person%' OR column_name LIKE '%customer%' OR column_name LIKE '%deleted%')
ORDER BY table_name, ordinal_position;
