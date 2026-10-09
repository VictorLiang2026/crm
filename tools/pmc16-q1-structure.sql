-- PMC-16 q1: 目标 11 表结构盘点（列/类型/可空/默认值），仅 information_schema 只读
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('interactions','followups','opportunities','actions','commitments',
                     'products','policy_review_reports','gifts','photos','ocr_records','ai_recommendations')
ORDER BY table_name, ordinal_position;
