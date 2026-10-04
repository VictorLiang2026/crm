-- WP07.1: service-role-only, atomic guard for Person-only recruit recycle actions.
-- The legacy public.crm_delete_batch contract and anon permissions are unchanged.
CREATE FUNCTION public.crm_person_only_recruit_delete_v1(
  p_actor_uid text, p_action text, p_ids bigint[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $guard$
DECLARE
  v_ids bigint[];
  v_people bigint[];
  v_people_after bigint[];
  v_count integer;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid actor';
  END IF;
  IF p_action NOT IN ('remove', 'restore') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid Person-only recruit action';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids
  FROM (SELECT DISTINCT x FROM unnest(p_ids) AS x WHERE x IS NOT NULL AND x > 0) AS valid_ids;
  IF coalesce(cardinality(v_ids), 0) NOT BETWEEN 1 AND 100
     OR (p_action = 'remove' AND cardinality(v_ids) <> 1) THEN
    RAISE EXCEPTION 'Invalid Person-only recruit IDs';
  END IF;

  SELECT count(*), array_agg(DISTINCT person_id ORDER BY person_id)
  INTO v_count, v_people
  FROM public.recruit_candidates
  WHERE id = ANY(v_ids) AND customer_id IS NULL;
  IF v_count <> cardinality(v_ids) OR v_people IS NULL THEN
    RAISE EXCEPTION 'Person-only recruit candidate not found';
  END IF;

  -- Match crm_delete_batch's parent-before-candidate lock order, then recheck
  -- the complete ID set under lock so a concurrent customer conversion cannot
  -- turn this scoped operation into a customer-linked delete.
  PERFORM id FROM public.persons WHERE id = ANY(v_people) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.recruit_candidates WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), array_agg(DISTINCT person_id ORDER BY person_id)
  INTO v_count, v_people_after
  FROM public.recruit_candidates
  WHERE id = ANY(v_ids) AND customer_id IS NULL;
  IF v_count <> cardinality(v_ids) OR v_people_after IS DISTINCT FROM v_people THEN
    RAISE EXCEPTION 'Person-only recruit candidate changed; retry' USING ERRCODE = '40001';
  END IF;
  IF (SELECT count(*) FROM public.persons
      WHERE id = ANY(v_people) AND deleted_at IS NULL) <> cardinality(v_people) THEN
    RAISE EXCEPTION 'Person-only recruit Person is unavailable';
  END IF;

  -- The test account may act only on a marked Person and a candidate whose
  -- IDs are both registered in the same protected test batch.
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid = p_actor_uid)
     AND EXISTS (
       SELECT 1 FROM public.recruit_candidates AS r
       JOIN public.persons AS p ON p.id = r.person_id
       WHERE r.id = ANY(v_ids) AND (
         position('【系统测试·勿联系】' IN coalesce(p.display_name, '')) = 0
         OR NOT EXISTS (
           SELECT 1 FROM public.crm_test_records AS candidate_record
           JOIN public.crm_test_records AS person_record
             ON person_record.batch_key = candidate_record.batch_key
            AND person_record.record_table = 'persons'
            AND person_record.record_id = r.person_id::text
           JOIN public.crm_test_batches AS batch
             ON batch.batch_key = candidate_record.batch_key
           WHERE batch.created_by_uid = p_actor_uid
             AND candidate_record.record_table = 'recruit_candidates'
             AND candidate_record.record_id = r.id::text
         )
       )
     ) THEN
    RAISE EXCEPTION 'Test account must use a tracked fictional Person';
  END IF;

  RETURN public.crm_delete_batch('recruit', p_action, v_ids);
END;
$guard$;

REVOKE ALL ON FUNCTION public.crm_person_only_recruit_delete_v1(text, text, bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_only_recruit_delete_v1(text, text, bigint[])
  TO service_role;
