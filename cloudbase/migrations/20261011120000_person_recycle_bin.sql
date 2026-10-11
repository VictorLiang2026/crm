-- Person recycle bin: cascade soft delete + restore for a canonical Person.
-- Additive only: nullable delete_batch_id columns, one command table, three service_role functions.
-- Legacy crm_delete_batch is unchanged and reused for the linked customer tree.
-- interactions/context_items/actions/commitments/person_roles intentionally keep no deleted_at:
-- every cross-person read already excludes soft-deleted persons, and per-person pages are
-- unreachable once the root is deleted, so those ledgers hide and reappear with the root.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- 1. Batch markers (nullable, idempotent). customers/recruit_candidates/recruit_followups already have one.
ALTER TABLE public.persons              ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.opportunities        ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.relationships        ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.households           ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.household_members    ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.activity_participants ADD COLUMN IF NOT EXISTS delete_batch_id uuid;
ALTER TABLE public.activity_speakers    ADD COLUMN IF NOT EXISTS delete_batch_id uuid;

-- 2. Preview/execute command table (same shape as person_identity_commands).
CREATE TABLE IF NOT EXISTS public.person_delete_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 200),
  idempotency_key uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
  executed_at timestamptz,
  UNIQUE(actor_uid,idempotency_key)
);
CREATE INDEX IF NOT EXISTS person_delete_commands_person_idx
  ON public.person_delete_commands(person_id, status, executed_at DESC);
ALTER TABLE public.person_delete_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_delete_commands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS person_delete_commands_service_only ON public.person_delete_commands;
CREATE POLICY person_delete_commands_service_only ON public.person_delete_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.person_delete_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.person_delete_commands TO service_role;

-- 3. Preview: verify the Person, count what a delete would cascade to.
CREATE OR REPLACE FUNCTION public.crm_person_delete_preview_v1(
  p_actor_uid text, p_idempotency_key uuid, p_person_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_existing public.person_delete_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_id uuid; v_preview jsonb;
  v_customer_id bigint; v_customer_deleted boolean;
  v_recruits bigint; v_opps bigint; v_interactions bigint; v_actions bigint;
  v_commitments bigint; v_contexts bigint; v_relationships bigint;
  v_households bigint; v_memberships bigint; v_participants bigint; v_speakers bigint;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(coalesce(p_actor_uid,'')), '') IS NULL
     OR p_person_id IS NULL OR p_person_id <= 0 THEN
    RAISE EXCEPTION 'Invalid person delete command';
  END IF;
  SELECT * INTO v_existing FROM public.person_delete_commands
    WHERE actor_uid = p_actor_uid AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.person_id <> p_person_id THEN
      RAISE EXCEPTION 'Idempotency key belongs to another command';
    END IF;
    RETURN jsonb_build_object('previewId',v_existing.id,'preview',v_existing.preview,
      'expiresAt',v_existing.expires_at,'status',v_existing.status,'result',v_existing.result);
  END IF;

  SELECT * INTO v_person FROM public.persons WHERE id = p_person_id;
  IF NOT FOUND OR v_person.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Person not found or already deleted';
  END IF;
  -- Test accounts may delete only their own tracked fictional Person.
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid = p_actor_uid)
     AND (position('【系统测试·勿联系】' IN coalesce(v_person.display_name,'')) = 0
       OR NOT EXISTS (
         SELECT 1 FROM public.crm_test_records AS r
         JOIN public.crm_test_batches AS b ON b.batch_key = r.batch_key
         WHERE b.created_by_uid = p_actor_uid
           AND r.record_table = 'persons' AND r.record_id = p_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE = '42501';
  END IF;

  SELECT c."Id", c.deleted_at IS NOT NULL INTO v_customer_id, v_customer_deleted
    FROM public.customers c WHERE c.person_id = p_person_id
    ORDER BY c.deleted_at NULLS FIRST, c."Id" LIMIT 1;
  SELECT count(*) INTO v_recruits FROM public.recruit_candidates rc
    WHERE rc.person_id = p_person_id AND rc.customer_id IS NULL AND rc.deleted_at IS NULL;
  SELECT count(*) INTO v_opps FROM public.opportunities o
    WHERE o.person_id = p_person_id AND o.deleted_at IS NULL;
  SELECT count(*) INTO v_interactions FROM public.interactions i WHERE i.person_id = p_person_id;
  SELECT count(*) INTO v_actions FROM public.actions a
    WHERE a.person_id = p_person_id AND a.status IN ('open','in_progress');
  SELECT count(*) INTO v_commitments FROM public.commitments cm
    WHERE cm.person_id = p_person_id AND cm.status = 'open';
  SELECT count(*) INTO v_contexts FROM public.context_items ci WHERE ci.person_id = p_person_id;
  SELECT count(*) INTO v_relationships FROM public.relationships r
    WHERE r.deleted_at IS NULL AND (r.from_person_id = p_person_id
      OR r.to_person_id = p_person_id OR r.introduced_by_person_id = p_person_id);
  SELECT count(*) INTO v_households FROM public.households hh
    WHERE hh.anchor_person_id = p_person_id AND hh.deleted_at IS NULL;
  SELECT count(*) INTO v_memberships FROM public.household_members hm
    WHERE hm.person_id = p_person_id AND hm.deleted_at IS NULL;
  SELECT count(*) INTO v_participants FROM public.activity_participants ap
    WHERE ap.canonical_person_id = p_person_id AND ap.deleted_at IS NULL;
  SELECT count(*) INTO v_speakers FROM public.activity_speakers s
    WHERE s.person_id = p_person_id AND s.deleted_at IS NULL;

  v_preview := jsonb_build_object(
    'personId', p_person_id,
    'displayName', v_person.display_name,
    'personUpdatedAt', v_person.updated_at,
    'customerId', CASE WHEN v_customer_id IS NOT NULL AND NOT v_customer_deleted
                       THEN v_customer_id ELSE NULL END,
    'customerAlreadyDeleted', coalesce(v_customer_deleted,false) AND v_customer_id IS NOT NULL,
    'recruitCount', v_recruits, 'opportunityCount', v_opps,
    'interactionCount', v_interactions, 'openActionCount', v_actions,
    'openCommitmentCount', v_commitments, 'contextItemCount', v_contexts,
    'relationshipCount', v_relationships, 'householdCount', v_households,
    'householdMembershipCount', v_memberships,
    'participantCount', v_participants, 'speakerCount', v_speakers);
  INSERT INTO public.person_delete_commands(actor_uid,idempotency_key,person_id,preview)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,v_preview) RETURNING id INTO v_id;
  RETURN jsonb_build_object('previewId',v_id,'preview',v_preview,
    'expiresAt',now()+interval '15 minutes','status','preview');
END;
$fn$;

-- 4. Execute: one transaction, batch-tagged cascade, linked customer tree via crm_delete_batch.
CREATE OR REPLACE FUNCTION public.crm_person_delete_execute_v1(
  p_actor_uid text, p_preview_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_cmd public.person_delete_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_person_id bigint; v_batch uuid; v_ts timestamptz;
  v_customer_id bigint; v_customer_batch uuid; v_customer_skipped boolean := false;
  v_res jsonb; v_rc_ids bigint[]; v_n bigint; v_counts jsonb := '{}'::jsonb;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(coalesce(p_actor_uid,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid person delete execution';
  END IF;
  SELECT * INTO v_cmd FROM public.person_delete_commands WHERE id = p_preview_id;
  IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Preview not found';
  END IF;
  IF v_cmd.status = 'executed' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'result',v_cmd.result);
  END IF;
  IF v_cmd.expires_at < now() THEN
    RAISE EXCEPTION 'Preview expired';
  END IF;
  v_person_id := v_cmd.person_id;

  SELECT * INTO v_person FROM public.persons WHERE id = v_person_id FOR UPDATE;
  IF NOT FOUND OR v_person.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Person changed or already deleted; preview again';
  END IF;
  IF v_person.updated_at <> (v_cmd.preview->>'personUpdatedAt')::timestamptz
     OR v_person.display_name <> (v_cmd.preview->>'displayName') THEN
    RAISE EXCEPTION 'Person changed; preview again';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid = p_actor_uid)
     AND (position('【系统测试·勿联系】' IN coalesce(v_person.display_name,'')) = 0
       OR NOT EXISTS (
         SELECT 1 FROM public.crm_test_records AS r
         JOIN public.crm_test_batches AS b ON b.batch_key = r.batch_key
         WHERE b.created_by_uid = p_actor_uid
           AND r.record_table = 'persons' AND r.record_id = v_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE = '42501';
  END IF;

  v_batch := gen_random_uuid();
  v_ts := clock_timestamp();

  -- Linked customer tree (legacy cascade: followups/gifts/photos/reports/ocr/products/recruits).
  v_customer_id := nullif(v_cmd.preview->>'customerId','')::bigint;
  IF v_customer_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" = v_customer_id AND deleted_at IS NULL) THEN
      v_res := public.crm_delete_batch('customer','remove',ARRAY[v_customer_id]);
      IF NOT coalesce((v_res->>'ok')::boolean,false) THEN
        RAISE EXCEPTION 'Customer cascade refused: %', coalesce(v_res->>'error','unknown');
      END IF;
      SELECT delete_batch_id INTO v_customer_batch FROM public.customers WHERE "Id" = v_customer_id;
    ELSE
      v_customer_skipped := true;
    END IF;
  END IF;

  -- Person-only recruit candidates + their followups.
  WITH changed AS (
    UPDATE public.recruit_candidates SET deleted_at = v_ts, delete_batch_id = v_batch
      WHERE person_id = v_person_id AND customer_id IS NULL AND deleted_at IS NULL
      RETURNING id)
    SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_rc_ids FROM changed;
  v_counts := jsonb_set(v_counts,'{recruit_candidates}',to_jsonb(cardinality(v_rc_ids)));
  UPDATE public.recruit_followups SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE candidate_id = ANY(v_rc_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{recruit_followups}',to_jsonb(v_n));

  UPDATE public.opportunities SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE person_id = v_person_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{opportunities}',to_jsonb(v_n));

  UPDATE public.relationships SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE deleted_at IS NULL AND (from_person_id = v_person_id
      OR to_person_id = v_person_id OR introduced_by_person_id = v_person_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{relationships}',to_jsonb(v_n));

  -- Household: memberships of this Person, then anchored households with all their member rows.
  UPDATE public.household_members SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE person_id = v_person_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{household_memberships}',to_jsonb(v_n));
  WITH hh AS (
    SELECT id FROM public.households
      WHERE anchor_person_id = v_person_id AND deleted_at IS NULL)
  UPDATE public.household_members hm SET deleted_at = v_ts, delete_batch_id = v_batch
    FROM hh WHERE hm.household_id = hh.id AND hm.deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{household_anchor_members}',to_jsonb(v_n));
  UPDATE public.households SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE anchor_person_id = v_person_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{households}',to_jsonb(v_n));

  UPDATE public.activity_participants SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE canonical_person_id = v_person_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{activity_participants}',to_jsonb(v_n));
  UPDATE public.activity_speakers SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE person_id = v_person_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{activity_speakers}',to_jsonb(v_n));

  UPDATE public.persons
    SET deleted_at = (v_ts AT TIME ZONE 'UTC'), delete_batch_id = v_batch, updated_at = now()
    WHERE id = v_person_id;
  PERFORM public.crm_person_roles_derive_v1(v_person_id);

  v_res := jsonb_build_object('personId',v_person_id,'batchId',v_batch,
    'customerId',v_customer_id,'customerBatchId',v_customer_batch,
    'customerSkipped',v_customer_skipped,'cascaded',v_counts,'deletedAt',v_ts);
  UPDATE public.person_delete_commands
    SET status='executed', executed_at=now(), result=v_res WHERE id = v_cmd.id;
  RETURN jsonb_build_object('ok',true,'result',v_res);
END;
$fn$;

-- 5. Restore: batch-tagged rows come back; customer tree only if its batch is untouched.
CREATE OR REPLACE FUNCTION public.crm_person_restore_v1(
  p_actor_uid text, p_person_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_person public.persons%ROWTYPE;
  v_cmd public.person_delete_commands%ROWTYPE;
  v_batch uuid; v_customer_id bigint; v_customer_batch uuid;
  v_res jsonb; v_n bigint; v_restored jsonb := '{}'::jsonb;
  v_rc_ids bigint[]; v_customer_restored boolean := false;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(coalesce(p_actor_uid,'')), '') IS NULL
     OR p_person_id IS NULL OR p_person_id <= 0 THEN
    RAISE EXCEPTION 'Invalid person restore command';
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id = p_person_id FOR UPDATE;
  IF NOT FOUND OR v_person.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Person not found or not deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid = p_actor_uid)
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_test_records AS r
       JOIN public.crm_test_batches AS b ON b.batch_key = r.batch_key
       WHERE b.created_by_uid = p_actor_uid
         AND r.record_table = 'persons' AND r.record_id = p_person_id::text) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE = '42501';
  END IF;

  v_batch := v_person.delete_batch_id;
  SELECT * INTO v_cmd FROM public.person_delete_commands
    WHERE person_id = p_person_id AND status = 'executed'
    ORDER BY executed_at DESC LIMIT 1;

  -- Restore the linked customer tree only when it was cascaded by us and not re-deleted since.
  IF FOUND THEN
    v_customer_id := nullif(v_cmd.result->>'customerId','')::bigint;
    v_customer_batch := nullif(v_cmd.result->>'customerBatchId','')::uuid;
    IF v_customer_id IS NOT NULL AND v_customer_batch IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.customers
                   WHERE "Id" = v_customer_id AND deleted_at IS NOT NULL
                     AND delete_batch_id = v_customer_batch) THEN
      v_res := public.crm_delete_batch('customer','restore',ARRAY[v_customer_id]);
      v_customer_restored := coalesce((v_res->>'ok')::boolean,false);
    END IF;
  END IF;

  IF v_batch IS NOT NULL THEN
    WITH changed AS (
      UPDATE public.recruit_candidates SET deleted_at = NULL, delete_batch_id = NULL
        WHERE person_id = p_person_id AND customer_id IS NULL
          AND delete_batch_id = v_batch AND deleted_at IS NOT NULL
        RETURNING id)
      SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_rc_ids FROM changed;
    v_restored := jsonb_set(v_restored,'{recruit_candidates}',to_jsonb(cardinality(v_rc_ids)));
    UPDATE public.recruit_followups SET deleted_at = NULL, delete_batch_id = NULL
      WHERE candidate_id = ANY(v_rc_ids) AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{recruit_followups}',to_jsonb(v_n));

    UPDATE public.opportunities SET deleted_at = NULL, delete_batch_id = NULL
      WHERE person_id = p_person_id AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{opportunities}',to_jsonb(v_n));
    UPDATE public.relationships SET deleted_at = NULL, delete_batch_id = NULL
      WHERE delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{relationships}',to_jsonb(v_n));
    UPDATE public.household_members SET deleted_at = NULL, delete_batch_id = NULL
      WHERE delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{household_members}',to_jsonb(v_n));
    UPDATE public.households SET deleted_at = NULL, delete_batch_id = NULL
      WHERE anchor_person_id = p_person_id AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{households}',to_jsonb(v_n));
    UPDATE public.activity_participants SET deleted_at = NULL, delete_batch_id = NULL
      WHERE canonical_person_id = p_person_id AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{activity_participants}',to_jsonb(v_n));
    UPDATE public.activity_speakers SET deleted_at = NULL, delete_batch_id = NULL
      WHERE person_id = p_person_id AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{activity_speakers}',to_jsonb(v_n));
  END IF;

  UPDATE public.persons SET deleted_at = NULL, delete_batch_id = NULL, updated_at = now()
    WHERE id = p_person_id;
  PERFORM public.crm_person_roles_derive_v1(p_person_id);

  RETURN jsonb_build_object('ok',true,'personId',p_person_id,
    'customerRestored',v_customer_restored,'restored',v_restored,
    'batchScoped',v_batch IS NOT NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_person_delete_preview_v1(text,uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_person_delete_execute_v1(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_person_restore_v1(text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_delete_preview_v1(text,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_person_delete_execute_v1(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_person_restore_v1(text,bigint) TO service_role;

COMMIT;
