-- PMC-14 开包盘点 Q1：参与者相关表实时结构（只读，脱敏，无 PII）
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'activities', 'activity_participants', 'activity_speakers',
    'activity_tasks', 'activity_reports', 'activity_topics'
  )
ORDER BY c.table_name, c.ordinal_position;
