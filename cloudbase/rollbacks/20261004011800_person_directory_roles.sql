-- WP07.1 guarded rollback. Preserve any Person-only recruitment data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recruit_candidates WHERE customer_id IS NULL) THEN
    RAISE EXCEPTION 'Person-only candidates exist; export/resolve them before rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.person_identity_commands
             WHERE status='preview' AND expires_at>now()) THEN
    RAISE EXCEPTION 'Active identity previews exist; let them expire before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.person_identity_execute_v1(text,uuid);
DROP TRIGGER customer_person_identity_bridge_trigger ON public.customers;
DROP FUNCTION public.customer_person_identity_bridge();
DROP FUNCTION public.person_identity_preview_v1(text,uuid,text,jsonb);
DROP FUNCTION public.person_directory_page_v1(integer,integer,text,text,text);
DROP VIEW public.v_recruit_candidates_person_only_trash;
DROP VIEW public.v_recruit_candidates_person_only;
DROP TABLE public.person_identity_commands;
DROP INDEX public.recruit_candidates_person_active_uq;
DROP INDEX public.persons_display_name_active_uq;
ALTER TABLE public.recruit_candidates ALTER COLUMN customer_id SET NOT NULL;
-- The original views, trigger function and deletion function follow below.
CREATE OR REPLACE FUNCTION public.recruit_candidate_person_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $sync$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_person_id bigint;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE "Id" = NEW.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate customer does not exist'; END IF;

  SELECT id INTO v_person_id FROM public.persons
  WHERE legacy_customer_id = v_customer."Id";
  IF v_person_id IS NULL THEN
    INSERT INTO public.persons (
      display_name, name_key, phone, wechat, gender, birthday, occupation,
      organization, education, source, notes, legacy_customer_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      v_customer.customer_name,
      lower(regexp_replace(btrim(regexp_replace(translate(v_customer.customer_name, '　', ' '),
        '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$', '')),
        '[[:space:]]+', ' ', 'g')),
      v_customer.phone, v_customer.wx_account, v_customer.gender,
      v_customer.birthday, v_customer.occupation, NULL,
      v_customer.education, v_customer.source, v_customer.additional_info,
      v_customer."Id", coalesce(v_customer.created_at, now()),
      coalesce(v_customer.updated_at, v_customer.created_at, now()),
      v_customer.deleted_at
    ) ON CONFLICT (legacy_customer_id) DO NOTHING;
    SELECT id INTO v_person_id FROM public.persons
    WHERE legacy_customer_id = v_customer."Id";
  END IF;
  IF v_person_id IS NULL THEN RAISE EXCEPTION 'Candidate Person resolution failed'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.person_id IS NOT NULL AND NEW.person_id <> v_person_id THEN
      RAISE EXCEPTION 'Candidate Person does not match customer';
    END IF;
  ELSIF NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
        AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'Candidate Person cannot be changed independently';
  END IF;
  NEW.person_id := v_person_id;
  RETURN NEW;
END;
$sync$;

CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.gender,
       c.birthday, c.phone, c.wx_account, c.occupation, c.annual_income,
       c.education, c.mbti, c.source, c.marital_status, c.hobbies,
       c.additional_info, rc.recommender_id, rc.stage, rc.stage_changed_at,
       rc.potential_score, rc.potential_reason, rc.motivation, rc.concerns,
       rc.work_experience, rc.family_situation, rc.personality_tags,
       rc.career_plan, rc.next_action_date, rc.next_action, rc.activity_history,
       rc.radar_image_file_id, rc.radar_image_name, rc.winner_report_file_id,
       rc.winner_report_name, rc.operator, rc.created_at, rc.updated_at,
       CASE WHEN rc.stage_changed_at IS NOT NULL
            THEN EXTRACT(DAY FROM now() - rc.stage_changed_at)::integer
            ELSE NULL::integer END AS idle_days,
       rc.profile, rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NULL AND c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.phone,
       c.occupation, rc.stage, rc.operator, rc.created_at, rc.updated_at,
       rc.deleted_at AS candidate_deleted_at, c.deleted_at AS customer_deleted_at,
       rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NOT NULL;


CREATE OR REPLACE VIEW public.v_action_center WITH (security_invoker=true) AS
 SELECT action_id,
    action_type,
    person_type,
    person_id,
    person_name,
    title,
    next_action,
    action_date,
    priority,
    source,
        CASE
            WHEN action_date IS NULL THEN 'unscheduled'::text
            WHEN action_date < CURRENT_DATE THEN 'overdue'::text
            WHEN action_date = CURRENT_DATE THEN 'today'::text
            WHEN action_date > CURRENT_DATE THEN 'upcoming'::text
            ELSE NULL::text
        END AS status,
    stage,
    days_until,
    last_followup_date
   FROM ( SELECT 'customer-'::text || c."Id" AS action_id,
            'customer'::text AS action_type,
            'customer'::text AS person_type,
            c."Id"::bigint AS person_id,
            c.customer_name AS person_name,
            '客户经营 · '::text || c.customer_name AS title,
            NULLIF(btrim(c.next_action), ''::text) AS next_action,
            c.next_action_date AS action_date,
            c.sales_priority::text AS priority,
            'customers'::text AS source,
            c.customer_stage::text AS stage,
            c.next_action_date - CURRENT_DATE AS days_until,
            ( SELECT max(f.followup_date) AS max
                   FROM public.followups f
                  WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL) AS last_followup_date
           FROM public.customers c
          WHERE c.deleted_at IS NULL AND (NULLIF(btrim(c.next_action), ''::text) IS NOT NULL OR c.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'followup-'::text || lf."Id",
            'followup'::text AS text,
            'customer'::text AS text,
            lf.customer_id::bigint AS customer_id,
            lf.customer_name,
            '跟进回访 · '::text || lf.customer_name,
            COALESCE(NULLIF(btrim(lf.next_action), ''::text), NULLIF(btrim(lf.interaction_summary), ''::text), lf.next_followup_goal) AS "coalesce",
            COALESCE(lf.next_action_date, lf.next_followup_date) AS "coalesce",
            NULL::text AS text,
            'followups'::text AS text,
            c2.customer_stage::text AS customer_stage,
            COALESCE(lf.next_action_date, lf.next_followup_date) - CURRENT_DATE,
            lf.followup_date
           FROM ( SELECT DISTINCT ON (f.customer_id) f."Id",
                    f.customer_id,
                    f.customer_name,
                    f.followup_date,
                    f.next_action,
                    f.next_action_date,
                    f.next_followup_date,
                    f.next_followup_goal,
                    f.interaction_summary
                   FROM public.followups f
                  WHERE f.deleted_at IS NULL AND (f.next_action_date IS NOT NULL OR f.next_followup_date IS NOT NULL OR NULLIF(btrim(f.next_action), ''::text) IS NOT NULL)
                  ORDER BY f.customer_id, f.followup_date DESC NULLS LAST, f."Id" DESC) lf
             LEFT JOIN public.customers c2 ON c2."Id" = lf.customer_id AND c2.deleted_at IS NULL
        UNION ALL
         SELECT 'opportunity-'::text || o.id,
            'opportunity'::text AS text,
            'customer'::text AS text,
            o.customer_id::bigint AS customer_id,
            COALESCE(c3.customer_name, '客户#'::text || o.customer_id) AS "coalesce",
            (o.opportunity_type || '机会跟进 · '::text) || COALESCE(c3.customer_name, '客户#'::text || o.customer_id),
            COALESCE(NULLIF(btrim(o.next_action), ''::text), NULLIF(btrim(o.last_progress), ''::text)) AS "coalesce",
            o.next_action_date,
            NULL::text AS text,
            'opportunities'::text AS text,
            o.status,
            o.next_action_date - CURRENT_DATE,
            ( SELECT max(f.followup_date) AS max
                   FROM public.followups f
                  WHERE f.customer_id = o.customer_id AND f.deleted_at IS NULL) AS max
           FROM public.opportunities o
             LEFT JOIN public.customers c3 ON c3."Id" = o.customer_id AND c3.deleted_at IS NULL
          WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL AND (o.status <> ALL (ARRAY['成交'::text, '关闭'::text]))
        UNION ALL
         SELECT 'recruit-'::text || rc.id,
            'recruit'::text AS text,
            'recruit'::text AS text,
            rc.id,
            c4.customer_name,
            ((('增员推进 · '::text || c4.customer_name) || '（'::text) || rc.stage) || '）'::text,
            NULLIF(btrim(rc.next_action), ''::text) AS "nullif",
            rc.next_action_date,
            NULL::text AS text,
            'recruit_candidates'::text AS text,
            rc.stage,
            rc.next_action_date - CURRENT_DATE,
            ( SELECT max(rf.followup_date) AS max
                   FROM public.recruit_followups rf
                  WHERE rf.candidate_id = rc.id AND rf.deleted_at IS NULL) AS max
           FROM public.recruit_candidates rc
             JOIN public.customers c4 ON c4."Id" = rc.customer_id AND c4.deleted_at IS NULL
          WHERE rc.deleted_at IS NULL AND rc.stage <> '流失'::text AND (NULLIF(btrim(rc.next_action), ''::text) IS NOT NULL OR rc.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'recruit_followup-'::text || lr.id,
            'recruit_followup'::text AS text,
            'recruit'::text AS text,
            lr.candidate_id,
            COALESCE(c5.customer_name, '候选人#'::text || lr.candidate_id) AS "coalesce",
            '增员跟进 · '::text || COALESCE(c5.customer_name, '候选人#'::text || lr.candidate_id),
            COALESCE(NULLIF(btrim(lr.next_action), ''::text), NULLIF(btrim(lr.interaction_summary), ''::text), NULLIF(btrim(lr.next_followup_goal), ''::text)) AS "coalesce",
            COALESCE(lr.next_action_date, lr.next_followup_date) AS "coalesce",
            NULL::text AS text,
            'recruit_followups'::text AS text,
            rc5.stage,
            COALESCE(lr.next_action_date, lr.next_followup_date) - CURRENT_DATE,
            lr.followup_date
           FROM ( SELECT DISTINCT ON (rf.candidate_id) rf.id,
                    rf.candidate_id,
                    rf.followup_date,
                    rf.next_action,
                    rf.next_action_date,
                    rf.next_followup_date,
                    rf.next_followup_goal,
                    rf.interaction_summary
                   FROM public.recruit_followups rf
                  WHERE rf.deleted_at IS NULL AND (rf.next_action_date IS NOT NULL OR rf.next_followup_date IS NOT NULL OR NULLIF(btrim(rf.next_action), ''::text) IS NOT NULL)
                  ORDER BY rf.candidate_id, rf.followup_date DESC, rf.id DESC) lr
             JOIN public.recruit_candidates rc5 ON rc5.id = lr.candidate_id AND rc5.deleted_at IS NULL
             LEFT JOIN public.customers c5 ON c5."Id" = rc5.customer_id AND c5.deleted_at IS NULL
        UNION ALL
         SELECT 'activity_task-'::text || t.id,
            'activity_task'::text AS text,
            'activity'::text AS text,
            t.activity_id,
            COALESCE(a.name, '活动#'::text || t.activity_id) AS "coalesce",
            (COALESCE(a.name, '活动#'::text || t.activity_id) || ' · '::text) || t.task_title,
            COALESCE(NULLIF(btrim(t.note), ''::text), t.task_title) AS "coalesce",
            t.due_date,
            t.priority,
            'activity_tasks'::text AS text,
            t.status,
            t.due_date - CURRENT_DATE,
            NULL::date AS date
           FROM public.activity_tasks t
             LEFT JOIN public.activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
          WHERE (t.status = ANY (ARRAY['pending'::text, 'in_progress'::text])) AND a.deleted_at IS NULL) v;

CREATE OR REPLACE FUNCTION public.crm_delete_batch(p_kind text, p_action text, p_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ids bigint[]; v_id bigint; v_parent bigint; v_locked_parents bigint[];
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
      SELECT id, customer_id, deleted_at IS NOT NULL AS deleted, delete_batch_id INTO v_root
        FROM public.recruit_candidates WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      IF p_action = 'remove' THEN RETURN jsonb_build_object('ok',false,'error','not found or already deleted'); END IF;
      CONTINUE;
    END IF;
    IF p_kind = 'recruit' AND NOT coalesce(v_root.customer_id = ANY(v_locked_parents),false) THEN
      RAISE EXCEPTION 'Candidate parent changed; retry' USING ERRCODE = '40001';
    END IF;
    IF p_action = 'remove' AND v_root.deleted THEN
      RETURN jsonb_build_object('ok',false,'error','not found or already deleted');
    END IF;
    IF p_action = 'restore' AND NOT v_root.deleted THEN CONTINUE; END IF;
    IF p_kind = 'recruit' AND p_action = 'restore' THEN
      IF NOT EXISTS (SELECT 1 FROM public.customers WHERE "Id" = v_root.customer_id AND deleted_at IS NULL) THEN
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
