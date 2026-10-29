BEGIN;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';

ALTER TABLE public.gifts ADD COLUMN person_id bigint;

UPDATE public.gifts g SET person_id = c.person_id FROM public.customers c WHERE c."Id" = g.customer_id AND g.person_id IS NULL;

DO $check$ BEGIN IF EXISTS (SELECT 1 FROM public.gifts WHERE person_id IS NULL) THEN RAISE EXCEPTION 'Cannot attach all existing gifts to a Person'; END IF; END $check$;

ALTER TABLE public.gifts ALTER COLUMN person_id SET NOT NULL;

ALTER TABLE public.gifts ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.gifts ADD CONSTRAINT gifts_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;

CREATE INDEX gifts_active_person_date_id_idx ON public.gifts(person_id, given_date DESC NULLS LAST, "Id" DESC) WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW public.ai_recommendations_view AS
 SELECT a.id,
    a.created_at,
    a.customer_name,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal,
    a.nba,
    a.customer_id,
    p.gender,
    p.occupation,
    c.tags,
    p.customer_stage,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    g.gift_name,
    g.quantity,
    g.given_date,
    g.person_id AS gift_person_id
   FROM ((((public.ai_recommendations a
     LEFT JOIN public.customers c ON ((a.customer_id = c."Id")))
     LEFT JOIN public.persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.customer_name,
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at
           FROM public.followups
          WHERE (followups.customer_id = a.customer_id)
          ORDER BY followups.created_at DESC
         LIMIT 1) f ON (true))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.customer_name,
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.person_id,
            gifts.created_at
           FROM public.gifts
          WHERE (gifts.customer_id = a.customer_id)
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true));

CREATE OR REPLACE VIEW public.customers_view AS
 SELECT c."Id",
    p.display_name AS customer_name,
    p.sales_priority,
    (SELECT rc.recruitment_priority FROM public.recruit_candidates rc WHERE rc.person_id = p.id AND rc.deleted_at IS NULL ORDER BY rc.id DESC LIMIT 1) AS recruitment_priority,
    p.referral_priority,
    p.hobbies,
    c.additional_info,
    p.gender,
    p.source,
    c.tags,
    p.marital_status,
    c.properties_info,
    p.occupation,
    c.annual_income,
    c.household_income,
    c.updated_at,
    c.created_at,
    p.first_contact_date,
    p.birthday,
    p.customer_stage,
    p.phone,
    c.profile,
    c.deleted_at,
        CASE
            WHEN (p.birthday IS NOT NULL) THEN ((EXTRACT(year FROM age(now(), (p.birthday)::timestamp with time zone)))::integer +
            CASE
                WHEN (EXTRACT(month FROM age(now(), (p.birthday)::timestamp with time zone)) > (0)::numeric) THEN 1
                ELSE 0
            END)
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN (p.first_contact_date IS NOT NULL) THEN ((EXTRACT(year FROM (now() - (p.first_contact_date)::timestamp with time zone)))::integer +
            CASE
                WHEN (EXTRACT(month FROM (now() - (p.first_contact_date)::timestamp with time zone)) > (0)::numeric) THEN 1
                ELSE 0
            END)
            ELSE NULL::integer
        END AS contact_years,
    g.gift_name,
    g.quantity AS gift_quantity,
    g.notes AS gift_notes,
    g.given_date,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal,
    ph.photo_url,
    ph.thumbnail_url,
    ph.file_name,
    ph.content_type,
    g.person_id AS gift_person_id
   FROM (((((public.customers c
     LEFT JOIN public.persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.person_id,
            gifts.created_at
           FROM public.gifts
          WHERE (gifts.customer_id = c."Id")
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at,
            followups.updated_at
           FROM public.followups
          WHERE (followups.customer_id = c."Id")
          ORDER BY followups.created_at DESC
         LIMIT 1) f ON (true))
     LEFT JOIN LATERAL ( SELECT ai_recommendations.id,
            ai_recommendations.recommendation_date,
            ai_recommendations.suggested_followup_date,
            ai_recommendations.suggested_message,
            ai_recommendations.suggested_strategy,
            ai_recommendations.suggested_customer_stage,
            ai_recommendations.suggested_followup_goal,
            ai_recommendations.customer_id
           FROM public.ai_recommendations
          WHERE (ai_recommendations.customer_id = c."Id")
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT photos.id,
            photos.photo_url,
            photos.thumbnail_url,
            photos.file_name,
            photos.content_type,
            photos.sort_order,
            photos.created_at
           FROM public.photos
          WHERE (photos.customer_id = c."Id")
          ORDER BY photos.created_at DESC
         LIMIT 1) ph ON (true))
  ORDER BY c."Id" DESC;

CREATE OR REPLACE VIEW public.followups_view AS
 SELECT f."Id",
    f.customer_name,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    f.customer_id,
    f.created_at,
    p.gender,
    p.occupation,
    c.tags,
    p.customer_stage,
    g.gift_name,
    g.quantity,
    g.given_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_followup_date,
    g.person_id AS gift_person_id
   FROM ((((public.followups f
     LEFT JOIN public.customers c ON ((f.customer_id = c."Id")))
     LEFT JOIN public.persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.person_id,
            gifts.created_at
           FROM public.gifts
          WHERE (gifts.customer_id = f.customer_id)
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true))
     LEFT JOIN LATERAL ( SELECT ai_recommendations.id,
            ai_recommendations.recommendation_date,
            ai_recommendations.suggested_followup_date,
            ai_recommendations.suggested_message,
            ai_recommendations.suggested_strategy,
            ai_recommendations.suggested_customer_stage,
            ai_recommendations.suggested_followup_goal,
            ai_recommendations.customer_id
           FROM public.ai_recommendations
          WHERE (ai_recommendations.customer_id = f.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true));

CREATE OR REPLACE VIEW public.gifts_view AS
 SELECT g."Id",
    g.customer_name,
    g.gift_name,
    g.quantity,
    g.notes,
    g.given_date,
    g.customer_id,
    g.created_at,
    p.gender,
    p.occupation,
    c.tags,
    p.customer_stage,
    p.source,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal,
    g.person_id AS gift_person_id
   FROM ((((public.gifts g
     LEFT JOIN public.customers c ON ((c."Id" = g.customer_id)))
     LEFT JOIN public.persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at,
            followups.updated_at
           FROM public.followups
          WHERE (followups.customer_id = g.customer_id)
          ORDER BY followups.created_at DESC
         LIMIT 1) f ON (true))
     LEFT JOIN LATERAL ( SELECT ai_recommendations.id,
            ai_recommendations.recommendation_date,
            ai_recommendations.suggested_followup_date,
            ai_recommendations.suggested_message,
            ai_recommendations.suggested_strategy,
            ai_recommendations.suggested_customer_stage,
            ai_recommendations.suggested_followup_goal,
            ai_recommendations.customer_id
           FROM public.ai_recommendations
          WHERE (ai_recommendations.customer_id = g.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true))
  ORDER BY g.given_date DESC NULLS LAST;

CREATE OR REPLACE VIEW public.products_view AS
 SELECT pr.id,
    pr.created_at,
    pr.customer_id,
    pr.customer_name,
    pr.ap_ipa,
    pr.ap_ltc,
    pr.ap_ann,
    pr.ap_life,
    pr.ap_term,
    pr.ap_wl,
    pr.ap_pa,
    pr.ap_ci,
    pr.ap_hi,
    pr.ap_all,
    p.gender,
    p.occupation,
    c.tags,
    p.customer_stage,
    p.source,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal,
    g.gift_name,
    g.quantity AS gift_quantity,
    g.given_date,
    g.notes AS gift_notes,
    g.person_id AS gift_person_id
   FROM (((((public.products pr
     LEFT JOIN public.customers c ON ((pr.customer_id = c."Id")))
     LEFT JOIN public.persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at
           FROM public.followups
          WHERE (followups.customer_id = pr.customer_id)
          ORDER BY followups.created_at DESC
         LIMIT 1) f ON (true))
     LEFT JOIN LATERAL ( SELECT ai_recommendations.id,
            ai_recommendations.recommendation_date,
            ai_recommendations.suggested_followup_date,
            ai_recommendations.suggested_message,
            ai_recommendations.suggested_strategy,
            ai_recommendations.suggested_customer_stage,
            ai_recommendations.suggested_followup_goal,
            ai_recommendations.customer_id
           FROM public.ai_recommendations
          WHERE (ai_recommendations.customer_id = pr.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.person_id,
            gifts.created_at
           FROM public.gifts
          WHERE (gifts.customer_id = pr.customer_id)
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true));

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
  v_commitments bigint; v_contexts bigint; v_relationships bigint; v_gifts bigint;
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
  SELECT count(*) INTO v_gifts FROM public.gifts g
    WHERE g.person_id = p_person_id AND g.deleted_at IS NULL;
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
    'giftCount', v_gifts, 'relationshipCount', v_relationships, 'householdCount', v_households,
    'householdMembershipCount', v_memberships,
    'participantCount', v_participants, 'speakerCount', v_speakers);
  INSERT INTO public.person_delete_commands(actor_uid,idempotency_key,person_id,preview)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,v_preview) RETURNING id INTO v_id;
  RETURN jsonb_build_object('previewId',v_id,'preview',v_preview,
    'expiresAt',now()+interval '15 minutes','status','preview');
END;
$fn$;

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

  -- Person-only gifts are tagged in this Person batch.
  UPDATE public.gifts SET deleted_at = v_ts, delete_batch_id = v_batch
    WHERE person_id = v_person_id AND customer_id IS NULL AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts,'{gifts}',to_jsonb(v_n));

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
    UPDATE public.gifts SET deleted_at = NULL, delete_batch_id = NULL
      WHERE person_id = p_person_id AND customer_id IS NULL
        AND delete_batch_id = v_batch AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := jsonb_set(v_restored,'{gifts}',to_jsonb(v_n));

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



