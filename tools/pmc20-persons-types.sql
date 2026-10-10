SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='persons'
  AND column_name IN ('display_name','phone','birthday','gender','occupation','education','wechat')
ORDER BY column_name;
