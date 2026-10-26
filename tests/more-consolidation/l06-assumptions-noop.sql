BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL lock_timeout = '5s';
DO $test$
DECLARE rows_json jsonb; row_json jsonb; invalid_json jsonb; before_hash text; after_hash text; result jsonb; rejected boolean; attempt integer;
BEGIN
 SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text),
 jsonb_agg(jsonb_build_object('stage_from',b.stage_from,'stage_to',b.stage_to,
 'conversion_min',b.conversion_min,'conversion_avg',b.conversion_avg,'conversion_good',b.conversion_good,
 'updated_at',b.updated_at) ORDER BY b.id)
 INTO before_hash,rows_json FROM public.recruit_goal_benchmarks b;
 IF jsonb_array_length(rows_json)<>7 THEN RAISE EXCEPTION 'Unexpected benchmark baseline'; END IF;
 result:=public.crm_recruit_benchmarks_save_v1(rows_json);
 IF result IS DISTINCT FROM '{"ok":true,"updated":0}'::jsonb THEN RAISE EXCEPTION 'No-op full save failed'; END IF;
 row_json:=rows_json->0;
 result:=public.crm_recruit_benchmarks_save_v1(jsonb_build_array(row_json));
 IF result IS DISTINCT FROM '{"ok":true,"updated":0}'::jsonb THEN RAISE EXCEPTION 'No-op subset failed'; END IF;
 FOR attempt IN 1..9 LOOP
  invalid_json:=CASE attempt
   WHEN 1 THEN '[]'::jsonb
   WHEN 2 THEN jsonb_build_array(row_json,row_json)
   WHEN 3 THEN jsonb_build_array(row_json||'{"conversion_min":0}'::jsonb)
   WHEN 4 THEN jsonb_build_array(row_json||'{"conversion_avg":"20"}'::jsonb)
   WHEN 5 THEN jsonb_build_array(row_json||'{"conversion_good":101}'::jsonb)
   WHEN 6 THEN jsonb_build_array(row_json||'{"updated_at":"2000-01-01T00:00:00Z"}'::jsonb)
   WHEN 7 THEN jsonb_build_array(row_json||'{"stage_to":"invalid"}'::jsonb)
   WHEN 8 THEN jsonb_build_array(row_json||'{"conversion_min":90,"conversion_avg":20}'::jsonb)
   ELSE jsonb_build_array(row_json)||jsonb_build_array((rows_json->1)||'{"updated_at":"2000-01-01T00:00:00Z"}'::jsonb)
  END;
  rejected:=false;
  BEGIN
   PERFORM public.crm_recruit_benchmarks_save_v1(invalid_json);
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Invalid input accepted: %',attempt; END IF;
 END LOOP;
 SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text) INTO after_hash FROM public.recruit_goal_benchmarks b;
 IF before_hash IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'Benchmark values or versions changed'; END IF;
 RAISE NOTICE 'L06: 2 valid no-op calls and 9 rejected cases; existing rows and versions unchanged';
END $test$;
ROLLBACK;
