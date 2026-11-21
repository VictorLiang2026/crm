BEGIN;
DO $migration$
DECLARE
  ddl text := pg_catalog.pg_get_functiondef('public.crm_daily_inspiration_v1(text,text,jsonb)'::regprocedure);
  old_quote_guard constant text := 'IF jsonb_object_length(d) <> (CASE WHEN d ? ''id'' THEN 8 ELSE 7 END)';
  new_quote_guard constant text := 'IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(d)) <> (7 + (d ? ''id'')::integer + (d ? ''recommendationScore'')::integer)';
  object_size constant text := '(SELECT count(*) FROM pg_catalog.jsonb_object_keys(d))';
  item_size constant text := '(SELECT count(*) FROM pg_catalog.jsonb_object_keys(CASE WHEN jsonb_typeof(item) = ''object'' THEN item ELSE ''{}''::jsonb END))';
BEGIN
  IF cardinality(string_to_array(ddl,new_quote_guard)) <> 2
     OR cardinality(string_to_array(ddl,object_size)) <> 7
     OR cardinality(string_to_array(ddl,item_size)) <> 2 THEN
    RAISE EXCEPTION 'Unexpected daily inspiration RPC definition';
  END IF;

  ddl := replace(ddl,new_quote_guard,old_quote_guard);
  ddl := replace(ddl,object_size,'jsonb_object_length(d)');
  ddl := replace(ddl,item_size,'jsonb_object_length(item)');
  EXECUTE ddl;
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
