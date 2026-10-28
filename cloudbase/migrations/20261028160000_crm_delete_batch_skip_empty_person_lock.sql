-- Skip the Person row lock when every recruit candidate is linked to a customer.
-- The locked customer row already serializes customer-linked candidate deletion.
-- Person-only candidates still lock their Person row as before.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $baseline$
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef('public.crm_delete_batch(text,text,bigint[])'::regprocedure))
       IS DISTINCT FROM '34f1d88750276b554dab024fc00a14a2' THEN
    RAISE EXCEPTION 'crm_delete_batch changed since the production baseline; inspect before applying';
  END IF;
END
$baseline$;

CREATE OR REPLACE FUNCTION public.crm_delete_batch(p_kind text, p_action text, p_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ids bigint[]; v_id bigint; v_parent bigint; v_locked_parents bigint[]; v_locked_people bigint[];
  v_root record; v_batch uuid; v_ts timestamptz; v_cands bigint[];
  v_table text; v_n bigint; v_restored integer := 0;
  v_counts jsonb := '{}'::jsonb; v_skipped jsonb := '[]'::jsonb;
  v_legacy jsonb := '[]'::jsonb;
BEGIN
  IF p_kind NOT IN ('customer','recruit') OR p_kind IS NULL
     OR p_action NOT IN ('remove','restore') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid delete-batch operation';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids
    FROM (SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL AND x <> 0) s;
  IF coalesce(cardinality(v_ids),0) = 0 OR cardinality(v_ids) > 100
     OR (p_action = 'remove' AND cardinality(v_ids) <> 1) THEN
    RAISE EXCEPTION 'Expected 1..100 IDs (one ID for remove)';
  END IF;
  -- All operations lock customers before candidates, in ascending ID order.
  IF p_kind = 'customer' THEN
    v_locked_parents := v_ids;
  ELSE
    SELECT array_agg(DISTINCT customer_id ORDER BY customer_id) INTO v_locked_parents
      FROM public.recruit_candidates WHERE id = ANY(v_ids);
  END IF;
  PERFORM "Id" FROM public.customers WHERE "Id" = ANY(v_locked_parents) ORDER BY "Id" FOR UPDATE;
  IF p_kind = 'recruit' THEN
    SELECT array_agg(DISTINCT person_id ORDER BY person_id) INTO v_locked_people
      FROM public.recruit_candidates WHERE id = ANY(v_ids) AND customer_id IS NULL;
    IF v_locked_people IS NOT NULL THEN
      PERFORM id FROM public.persons WHERE id = ANY(v_locked_people) ORDER BY id FOR UPDATE;
    END IF;
  END IF;
  IF p_kind = 'customer' THEN
    PERFORM id FROM public.recruit_candidates WHERE customer_id = ANY(v_ids) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM id FROM public.recruit_candidates WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF p_kind = 'customer' THEN
      SELECT "Id"::bigint AS id, "Id"::bigint AS customer_id,
        deleted_at IS NOT NULL AS deleted, delete_batch_id INTO v_root
        FROM public.customers WHERE "Id" = v_id;
    ELSE
      SELECT id, customer_id, person_id, deleted_at IS NOT NULL AS deleted, delete_batch_id INTO v_root
        FROM public.recruit_candidates WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      IF p_action = 'remove' THEN RETURN jsonb_build_object('ok',false,'error','not found or already deleted'); END IF;
      CONTINUE;
    END IF;
    -- Nested guards: the person_id field must only be touched on the recruit path, where
    -- v_root actually carries that column (customer rows do not, see incident comment above).
    IF p_kind = 'recruit' THEN
      IF NOT coalesce(v_root.customer_id = ANY(v_locked_parents),false)
         AND NOT (v_root.customer_id IS NULL
                  AND coalesce(v_root.person_id = ANY(v_locked_people),false)) THEN
        RAISE EXCEPTION 'Candidate parent changed; retry' USING ERRCODE = '40001';
      END IF;
    END IF;
    IF p_action = 'remove' AND v_root.deleted THEN
      RETURN jsonb_build_object('ok',false,'error','not found or already deleted');
    END IF;
    IF p_action = 'restore' AND NOT v_root.deleted THEN CONTINUE; END IF;
    IF p_kind = 'recruit' AND p_action = 'restore' THEN
      IF v_root.customer_id IS NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id=v_root.person_id AND deleted_at IS NULL) THEN
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id',v_id,'reason','Person 仍在回收站或不存在'));
          CONTINUE;
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM public.customers WHERE "Id" = v_root.customer_id AND deleted_at IS NULL) THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id',v_id,'reason','客户仍在回收站或不存在，请先恢复客户'));
        CONTINUE;
      END IF;
    END IF;
    v_batch := v_root.delete_batch_id;
    v_ts := clock_timestamp();
    IF p_action = 'remove' THEN
      v_batch := gen_random_uuid();
      IF p_kind = 'customer' THEN
        UPDATE public.customers SET deleted_at = v_ts AT TIME ZONE 'UTC', delete_batch_id = v_batch WHERE "Id" = v_id;
      ELSE
        UPDATE public.recruit_candidates SET deleted_at = v_ts, delete_batch_id = v_batch WHERE id = v_id;
      END IF;
    END IF;
    -- Legacy roots have no reliable membership evidence: restore only the root.
    IF v_batch IS NOT NULL THEN
      IF p_kind = 'customer' THEN
        FOREACH v_table IN ARRAY ARRAY['followups','gifts','photos','policy_review_reports','ocr_records','products'] LOOP
          IF p_action = 'remove' THEN
            EXECUTE format('UPDATE public.%I SET deleted_at=$1, delete_batch_id=$2 WHERE customer_id=$3 AND deleted_at IS NULL',v_table)
              USING v_ts,v_batch,v_id;
          ELSE
            EXECUTE format('UPDATE public.%I SET deleted_at=NULL, delete_batch_id=NULL WHERE customer_id=$1 AND delete_batch_id=$2 AND deleted_at IS NOT NULL',v_table)
              USING v_id,v_batch;
          END IF;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_counts := jsonb_set(v_counts,ARRAY[v_table],to_jsonb(coalesce((v_counts->>v_table)::bigint,0)+v_n));
        END LOOP;
        IF p_action = 'remove' THEN
          WITH changed AS (UPDATE public.recruit_candidates SET deleted_at=v_ts, delete_batch_id=v_batch
            WHERE customer_id=v_id AND deleted_at IS NULL RETURNING id)
            SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_cands FROM changed;
        ELSE
          SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_cands FROM public.recruit_candidates
            WHERE customer_id=v_id AND deleted_at IS NOT NULL AND delete_batch_id=v_batch;
          UPDATE public.recruit_candidates SET deleted_at=NULL, delete_batch_id=NULL
            WHERE id=ANY(v_cands) AND customer_id=v_id AND delete_batch_id=v_batch AND deleted_at IS NOT NULL;
        END IF;
        v_counts := jsonb_set(v_counts,ARRAY['recruit_candidates'],
          to_jsonb(coalesce((v_counts->>'recruit_candidates')::bigint,0)+cardinality(v_cands)));
      ELSE
        v_cands := ARRAY[v_id];
      END IF;
      IF p_action = 'remove' THEN
        UPDATE public.recruit_followups SET deleted_at=v_ts, delete_batch_id=v_batch
          WHERE candidate_id=ANY(v_cands) AND deleted_at IS NULL;
      ELSE
        UPDATE public.recruit_followups SET deleted_at=NULL, delete_batch_id=NULL
          WHERE candidate_id=ANY(v_cands) AND delete_batch_id=v_batch AND deleted_at IS NOT NULL;
      END IF;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := jsonb_set(v_counts,ARRAY['recruit_followups'],
        to_jsonb(coalesce((v_counts->>'recruit_followups')::bigint,0)+v_n));
    ELSE
      v_legacy := v_legacy || jsonb_build_array(v_id);
    END IF;
    IF p_action = 'restore' THEN
      IF p_kind = 'customer' THEN
        UPDATE public.customers SET deleted_at=NULL, delete_batch_id=NULL WHERE "Id"=v_id;
      ELSE
        UPDATE public.recruit_candidates SET deleted_at=NULL, delete_batch_id=NULL WHERE id=v_id;
      END IF;
      v_restored := v_restored + 1;
    END IF;
  END LOOP;
  IF p_action = 'remove' THEN
    RETURN jsonb_build_object('ok',true,'deleted_at',v_ts,'cascaded',v_counts);
  END IF;
  RETURN jsonb_build_object('ok',true,'restored',v_restored,'cascaded',v_counts,
    'skipped',v_skipped,'legacy_restored',v_legacy);
END;
$fn$;

COMMIT;
