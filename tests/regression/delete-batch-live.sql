-- Live write regression for public.crm_delete_batch.
-- All rows use negative IDs plus [CRM_TEST_ONLY]; the DO block is atomic and removes them on success.
DO $test$
DECLARE
  c_id integer := -92209001;
  legacy_c_id integer := -92209002;
  active_f_id integer := -92209101;
  old_f_id integer := -92209102;
  standalone_f_id integer := -92209103;
  legacy_f_id integer := -92209104;
  active_rc_id bigint := -92209201;
  old_rc_id bigint := -92209202;
  active_rf_id bigint := -92209301;
  old_rf_id bigint := -92209302;
  old_rc_rf_id bigint := -92209303;
  v_batch uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" IN (c_id, legacy_c_id))
     OR EXISTS (SELECT 1 FROM public.followups WHERE "Id" BETWEEN -92209199 AND -92209100)
     OR EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id IN (active_rc_id, old_rc_id))
     OR EXISTS (SELECT 1 FROM public.recruit_followups WHERE id BETWEEN -92209399 AND -92209300) THEN
    RAISE EXCEPTION 'CRM_TEST_ONLY fixture IDs already exist';
  END IF;

  INSERT INTO public.customers ("Id", customer_name) VALUES
    (c_id, '[CRM_TEST_ONLY] delete batch customer'),
    (legacy_c_id, '[CRM_TEST_ONLY] legacy delete customer');

  INSERT INTO public.followups ("Id", customer_id, customer_name, followup_notes, deleted_at) VALUES
    (active_f_id, c_id, '[CRM_TEST_ONLY] delete batch customer', '[CRM_TEST_ONLY] active child', NULL),
    (old_f_id, c_id, '[CRM_TEST_ONLY] delete batch customer', '[CRM_TEST_ONLY] historical independent child', clock_timestamp() - interval '30 days'),
    (standalone_f_id, c_id, '[CRM_TEST_ONLY] delete batch customer', '[CRM_TEST_ONLY] standalone hard delete', NULL),
    (legacy_f_id, legacy_c_id, '[CRM_TEST_ONLY] legacy delete customer', '[CRM_TEST_ONLY] legacy historical child', clock_timestamp() - interval '60 days');

  -- Existing standalone child deletion remains a hard delete and must never reappear.
  DELETE FROM public.followups WHERE "Id" = standalone_f_id;

  INSERT INTO public.recruit_candidates (id, customer_id, stage, deleted_at) VALUES
    (active_rc_id, c_id, '新增人才', NULL),
    (old_rc_id, c_id, '新增人才', clock_timestamp() - interval '30 days');

  INSERT INTO public.recruit_followups (id, candidate_id, followup_date, followup_notes, deleted_at) VALUES
    (active_rf_id, active_rc_id, current_date, '[CRM_TEST_ONLY] active recruit child', NULL),
    (old_rf_id, active_rc_id, current_date - 30, '[CRM_TEST_ONLY] historical recruit child', clock_timestamp() - interval '30 days'),
    (old_rc_rf_id, old_rc_id, current_date - 30, '[CRM_TEST_ONLY] old candidate child', clock_timestamp() - interval '30 days');

  PERFORM public.crm_delete_batch('customer', 'remove', ARRAY[c_id::bigint]);
  SELECT delete_batch_id INTO v_batch FROM public.customers WHERE "Id" = c_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'customer remove did not assign batch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.followups WHERE "Id" = active_f_id AND deleted_at IS NOT NULL AND delete_batch_id = v_batch) THEN
    RAISE EXCEPTION 'active child did not join customer batch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.followups WHERE "Id" = old_f_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical child was rewritten by customer remove';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id = active_rc_id AND deleted_at IS NOT NULL AND delete_batch_id = v_batch) THEN
    RAISE EXCEPTION 'active candidate did not join customer batch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id = old_rc_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical candidate was rewritten by customer remove';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_followups WHERE id = active_rf_id AND deleted_at IS NOT NULL AND delete_batch_id = v_batch) THEN
    RAISE EXCEPTION 'active recruit followup did not join customer batch';
  END IF;

  PERFORM public.crm_delete_batch('customer', 'restore', ARRAY[c_id::bigint]);
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" = c_id AND (deleted_at IS NOT NULL OR delete_batch_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'customer root was not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM public.followups WHERE "Id" = active_f_id AND (deleted_at IS NOT NULL OR delete_batch_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'current-batch child was not restored';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.followups WHERE "Id" = old_f_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical child was restored incorrectly';
  END IF;
  IF EXISTS (SELECT 1 FROM public.followups WHERE "Id" = standalone_f_id) THEN
    RAISE EXCEPTION 'hard-deleted standalone child reappeared';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id = old_rc_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical candidate was restored incorrectly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_followups WHERE id = old_rf_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical recruit followup was restored incorrectly';
  END IF;

  -- Candidate-only deletion gets its own batch and restores only that batch.
  PERFORM public.crm_delete_batch('recruit', 'remove', ARRAY[active_rc_id]);
  SELECT delete_batch_id INTO v_batch FROM public.recruit_candidates WHERE id = active_rc_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'candidate remove did not assign batch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_followups WHERE id = active_rf_id AND delete_batch_id = v_batch AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'candidate child did not join candidate batch';
  END IF;
  PERFORM public.crm_delete_batch('recruit', 'restore', ARRAY[active_rc_id]);
  IF EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id = active_rc_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'candidate was not restored';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_followups WHERE id = old_rf_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'historical recruit followup was restored by candidate restore';
  END IF;

  -- Legacy roots have no membership evidence: only the root is restored.
  UPDATE public.customers SET deleted_at = clock_timestamp() AT TIME ZONE 'UTC', delete_batch_id = NULL WHERE "Id" = legacy_c_id;
  PERFORM public.crm_delete_batch('customer', 'restore', ARRAY[legacy_c_id::bigint]);
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" = legacy_c_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'legacy customer root was not restored';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.followups WHERE "Id" = legacy_f_id AND deleted_at IS NOT NULL AND delete_batch_id IS NULL) THEN
    RAISE EXCEPTION 'legacy customer restore touched historical child';
  END IF;

  DELETE FROM public.recruit_followups WHERE id IN (active_rf_id, old_rf_id, old_rc_rf_id);
  DELETE FROM public.recruit_candidates WHERE id IN (active_rc_id, old_rc_id);
  DELETE FROM public.followups WHERE "Id" IN (active_f_id, old_f_id, standalone_f_id, legacy_f_id);
  DELETE FROM public.customers WHERE "Id" IN (c_id, legacy_c_id);
END;
$test$;
