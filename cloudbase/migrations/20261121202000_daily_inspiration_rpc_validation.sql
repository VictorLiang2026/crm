BEGIN;
DO $migration$
DECLARE
  ddl text := pg_catalog.pg_get_functiondef('public.crm_daily_inspiration_v1(text,text,jsonb)'::regprocedure);
  old_quote_guard constant text := 'IF jsonb_object_length(d) <> (CASE WHEN d ? ''id'' THEN 8 ELSE 7 END)';
  new_quote_guard constant text := 'IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(d)) <> (7 + (d ? ''id'')::integer + (d ? ''recommendationScore'')::integer)';
BEGIN
  IF cardinality(string_to_array(ddl,old_quote_guard)) <> 2
     OR cardinality(string_to_array(ddl,'jsonb_object_length(d)')) <> 7
     OR cardinality(string_to_array(ddl,'jsonb_object_length(item)')) <> 2 THEN
    RAISE EXCEPTION 'Unexpected daily inspiration RPC definition';
  END IF;

  ddl := replace(ddl,old_quote_guard,new_quote_guard);
  ddl := replace(ddl,'jsonb_object_length(d)','(SELECT count(*) FROM pg_catalog.jsonb_object_keys(d))');
  ddl := replace(ddl,'jsonb_object_length(item)','(SELECT count(*) FROM pg_catalog.jsonb_object_keys(CASE WHEN jsonb_typeof(item) = ''object'' THEN item ELSE ''{}''::jsonb END))');
  EXECUTE ddl;
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
