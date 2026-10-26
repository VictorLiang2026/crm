BEGIN;
DO $guard$ BEGIN
 IF pg_catalog.to_regprocedure('public.crm_recruit_benchmarks_save_v1(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'L06 routine already exists; inspect before applying';
 END IF;
END $guard$;
CREATE FUNCTION public.crm_recruit_benchmarks_save_v1(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
 stages constant text[]:=ARRAY['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司'];
 item jsonb; from_stage text; to_stage text; stage_index integer;
 low_rate numeric; average_rate numeric; high_rate numeric;
 row_id bigint; row_version timestamptz; changed integer:=0; affected_count integer;
 pairs text[]:=ARRAY[]::text[];
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 7 THEN
  RAISE EXCEPTION 'Invalid personal assumptions';
 END IF;
 -- Validate all input shapes before mutation; version conflicts below roll back the whole transaction.
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item)<>'object' OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(item) AS fields(key) WHERE fields.key NOT IN
       ('stage_from','stage_to','conversion_min','conversion_avg','conversion_good','source','updated_at')) THEN
   RAISE EXCEPTION 'Invalid assumption fields';
  END IF;
  from_stage:=item->>'stage_from'; to_stage:=item->>'stage_to';
  stage_index:=array_position(stages,from_stage);
  IF stage_index IS NULL OR NOT coalesce(
    (stage_index<7 AND to_stage=stages[stage_index+1]) OR (from_stage=stages[1] AND to_stage=stages[7]),false) THEN
   RAISE EXCEPTION 'Invalid assumption stage pair';
  END IF;
  IF (from_stage||'→'||to_stage)=ANY(pairs) THEN RAISE EXCEPTION 'Duplicate assumption'; END IF;
  pairs:=array_append(pairs,from_stage||'→'||to_stage);
  IF jsonb_typeof(item->'conversion_min') IS DISTINCT FROM 'number' OR
     jsonb_typeof(item->'conversion_avg') IS DISTINCT FROM 'number' OR
     jsonb_typeof(item->'conversion_good') IS DISTINCT FROM 'number' OR
     jsonb_typeof(item->'updated_at') IS DISTINCT FROM 'string' OR
     (item ? 'source' AND jsonb_typeof(item->'source') IS DISTINCT FROM 'string') OR
     length(coalesce(item->>'source',''))>500 THEN RAISE EXCEPTION 'Invalid assumption values'; END IF;
  low_rate:=(item->>'conversion_min')::numeric; average_rate:=(item->>'conversion_avg')::numeric; high_rate:=(item->>'conversion_good')::numeric;
  IF low_rate<=0 OR average_rate<low_rate OR high_rate<average_rate OR high_rate>100 THEN
   RAISE EXCEPTION 'Assumptions must be 0 < low <= average <= high <= 100';
  END IF;
  row_version:=(item->>'updated_at')::timestamptz;
 END LOOP;
 -- Stable lock order. A missing or changed row aborts the entire RPC transaction.
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'stage_from', value->>'stage_to' LOOP
  SELECT b.id,b.updated_at INTO row_id,row_version FROM public.recruit_goal_benchmarks b
    WHERE b.stage_from=item->>'stage_from' AND b.stage_to=item->>'stage_to' FOR UPDATE;
  IF NOT FOUND OR row_version IS DISTINCT FROM (item->>'updated_at')::timestamptz THEN
   RAISE EXCEPTION 'Assumption changed; reload before saving' USING ERRCODE='40001';
  END IF;
  UPDATE public.recruit_goal_benchmarks SET
   conversion_min=(item->>'conversion_min')::numeric,
   conversion_avg=(item->>'conversion_avg')::numeric,
   conversion_good=(item->>'conversion_good')::numeric,
   source=CASE WHEN item ? 'source' THEN item->>'source' ELSE source END,
   updated_at=clock_timestamp()
   WHERE id=row_id AND (conversion_min IS DISTINCT FROM (item->>'conversion_min')::numeric
     OR conversion_avg IS DISTINCT FROM (item->>'conversion_avg')::numeric
     OR conversion_good IS DISTINCT FROM (item->>'conversion_good')::numeric
     OR (item ? 'source' AND source IS DISTINCT FROM item->>'source'));
  GET DIAGNOSTICS affected_count=ROW_COUNT;
  changed:=changed+affected_count;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'updated',changed);
END $function$;
REVOKE ALL ON FUNCTION public.crm_recruit_benchmarks_save_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
-- Existing recruit_goals rdb() uses the anonymous server channel; underlying forced RLS remains unchanged.
GRANT EXECUTE ON FUNCTION public.crm_recruit_benchmarks_save_v1(jsonb) TO anon, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
