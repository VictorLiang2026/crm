-- Rollback for Person field ownership phase 2. Restore legacy columns and view/function contracts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.customers
  ADD COLUMN source text,
  ADD COLUMN hobbies text,
  ADD COLUMN customer_stage public."客户经营阶段",
  ADD COLUMN sales_priority public."优先级",
  ADD COLUMN recruitment_priority public."优先级",
  ADD COLUMN referral_priority public."优先级",
  ADD COLUMN marital_status text,
  ADD COLUMN first_contact_date date;
ALTER TABLE public.activity_speakers
  ADD COLUMN phone text,
  ADD COLUMN wechat text,
  ADD COLUMN organization text,
  ADD COLUMN source text;

UPDATE public.customers c SET source=p.source, hobbies=p.hobbies,
  customer_stage=p.customer_stage, sales_priority=p.sales_priority,
  referral_priority=p.referral_priority, marital_status=p.marital_status,
  first_contact_date=p.first_contact_date
FROM public.persons p WHERE p.id=c.person_id;
UPDATE public.customers c SET recruitment_priority=rc.recruitment_priority
FROM public.recruit_candidates rc WHERE rc.person_id=c.person_id
  AND rc.recruitment_priority IS NOT NULL;
UPDATE public.activity_speakers s SET phone=p.phone, wechat=p.wechat,
  organization=p.organization, source=p.source
FROM public.persons p WHERE p.id=s.person_id;

-- ai_recommendations_view
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
    c.customer_stage,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    g.gift_name,
    g.quantity,
    g.given_date
   FROM ((((ai_recommendations a
     LEFT JOIN customers c ON ((a.customer_id = c."Id")))
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.customer_name,
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at
           FROM followups
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
            gifts.created_at
           FROM gifts
          WHERE (gifts.customer_id = a.customer_id)
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true));

-- customers_view
CREATE OR REPLACE VIEW public.customers_view AS
 SELECT c."Id",
    p.display_name AS customer_name,
    c.sales_priority,
    c.recruitment_priority,
    c.referral_priority,
    c.hobbies,
    c.additional_info,
    p.gender,
    c.source,
    c.tags,
    c.marital_status,
    c.properties_info,
    p.occupation,
    c.annual_income,
    c.household_income,
    c.updated_at,
    c.created_at,
    c.first_contact_date,
    p.birthday,
    c.customer_stage,
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
            WHEN (c.first_contact_date IS NOT NULL) THEN ((EXTRACT(year FROM (now() - (c.first_contact_date)::timestamp with time zone)))::integer +
            CASE
                WHEN (EXTRACT(month FROM (now() - (c.first_contact_date)::timestamp with time zone)) > (0)::numeric) THEN 1
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
    ph.content_type
   FROM (((((customers c
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.created_at
           FROM gifts
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
           FROM followups
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
           FROM ai_recommendations
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
           FROM photos
          WHERE (photos.customer_id = c."Id")
          ORDER BY photos.created_at DESC
         LIMIT 1) ph ON (true))
  ORDER BY c."Id" DESC;

-- followups_view
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
    c.customer_stage,
    g.gift_name,
    g.quantity,
    g.given_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_followup_date
   FROM ((((followups f
     LEFT JOIN customers c ON ((f.customer_id = c."Id")))
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.created_at
           FROM gifts
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
           FROM ai_recommendations
          WHERE (ai_recommendations.customer_id = f.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true));

-- gifts_view
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
    c.customer_stage,
    c.source,
    f.followup_notes,
    f.followup_date,
    f.next_followup_date,
    f.next_followup_goal,
    a.recommendation_date,
    a.suggested_followup_date,
    a.suggested_message,
    a.suggested_strategy,
    a.suggested_customer_stage,
    a.suggested_followup_goal
   FROM ((((gifts g
     LEFT JOIN customers c ON ((c."Id" = g.customer_id)))
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at,
            followups.updated_at
           FROM followups
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
           FROM ai_recommendations
          WHERE (ai_recommendations.customer_id = g.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true))
  ORDER BY g.given_date DESC NULLS LAST;

-- photos_view
CREATE OR REPLACE VIEW public.photos_view AS
 SELECT ph.id,
    ph.customer_id,
    ph.photo_url,
    ph.thumbnail_url,
    ph.file_name,
    ph.content_type,
    ph.sort_order,
    ph.created_at,
    ph.customer_name,
    p.gender,
    p.occupation,
    c.tags,
    c.customer_stage,
    c.source,
    c."Id"
   FROM ((photos ph
     LEFT JOIN customers c ON ((ph.customer_id = c."Id")))
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
  ORDER BY c."Id" DESC NULLS LAST;

-- products_view
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
    c.customer_stage,
    c.source,
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
    g.notes AS gift_notes
   FROM (((((products pr
     LEFT JOIN customers c ON ((pr.customer_id = c."Id")))
     LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT followups."Id",
            followups.followup_notes,
            followups.followup_date,
            followups.next_followup_date,
            followups.next_followup_goal,
            followups.customer_id,
            followups.created_at
           FROM followups
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
           FROM ai_recommendations
          WHERE (ai_recommendations.customer_id = pr.customer_id)
          ORDER BY ai_recommendations.created_at DESC
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT gifts."Id",
            gifts.gift_name,
            gifts.quantity,
            gifts.notes,
            gifts.given_date,
            gifts.customer_id,
            gifts.created_at
           FROM gifts
          WHERE (gifts.customer_id = pr.customer_id)
          ORDER BY gifts.created_at DESC
         LIMIT 1) g ON (true));

-- v_action_center
CREATE OR REPLACE VIEW public.v_action_center AS
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
            WHEN (action_date IS NULL) THEN 'unscheduled'::text
            WHEN (action_date < CURRENT_DATE) THEN 'overdue'::text
            WHEN (action_date = CURRENT_DATE) THEN 'today'::text
            WHEN (action_date > CURRENT_DATE) THEN 'upcoming'::text
            ELSE NULL::text
        END AS status,
    stage,
    days_until,
    last_followup_date
   FROM ( SELECT ('customer-'::text || c."Id") AS action_id,
            'customer'::text AS action_type,
            'customer'::text AS person_type,
            (c."Id")::bigint AS person_id,
            COALESCE(p.display_name, ('客户#'::text || c."Id")) AS person_name,
            ('客户经营 · '::text || COALESCE(p.display_name, ('客户#'::text || c."Id"))) AS title,
            NULLIF(btrim(c.next_action), ''::text) AS next_action,
            c.next_action_date AS action_date,
            (c.sales_priority)::text AS priority,
            'customers'::text AS source,
            (c.customer_stage)::text AS stage,
            (c.next_action_date - CURRENT_DATE) AS days_until,
            ( SELECT max(f.followup_date) AS max
                   FROM followups f
                  WHERE ((f.customer_id = c."Id") AND (f.deleted_at IS NULL))) AS last_followup_date
           FROM (customers c
             LEFT JOIN persons p ON (((p.id = c.person_id) AND (p.deleted_at IS NULL))))
          WHERE ((c.deleted_at IS NULL) AND ((NULLIF(btrim(c.next_action), ''::text) IS NOT NULL) OR (c.next_action_date IS NOT NULL)))
        UNION ALL
         SELECT ('followup-'::text || lf."Id"),
            'followup'::text AS action_type,
            'customer'::text AS person_type,
            (lf.customer_id)::bigint AS person_id,
            COALESCE(p2.display_name, lf.customer_name) AS person_name,
            ('跟进回访 · '::text || COALESCE(p2.display_name, lf.customer_name)) AS title,
            COALESCE(NULLIF(btrim(lf.next_action), ''::text), NULLIF(btrim(lf.interaction_summary), ''::text), lf.next_followup_goal) AS next_action,
            COALESCE(lf.next_action_date, lf.next_followup_date) AS action_date,
            NULL::text AS priority,
            'followups'::text AS source,
            (c2.customer_stage)::text AS stage,
            (COALESCE(lf.next_action_date, lf.next_followup_date) - CURRENT_DATE) AS days_until,
            lf.followup_date AS last_followup_date
           FROM ((( SELECT DISTINCT ON (f.customer_id) f."Id",
                    f.customer_id,
                    f.customer_name,
                    f.followup_date,
                    f.next_action,
                    f.next_action_date,
                    f.next_followup_date,
                    f.next_followup_goal,
                    f.interaction_summary
                   FROM followups f
                  WHERE ((f.deleted_at IS NULL) AND ((f.next_action_date IS NOT NULL) OR (f.next_followup_date IS NOT NULL) OR (NULLIF(btrim(f.next_action), ''::text) IS NOT NULL)))
                  ORDER BY f.customer_id, f.followup_date DESC NULLS LAST, f."Id" DESC) lf
             LEFT JOIN customers c2 ON (((c2."Id" = lf.customer_id) AND (c2.deleted_at IS NULL))))
             LEFT JOIN persons p2 ON (((p2.id = c2.person_id) AND (p2.deleted_at IS NULL))))
        UNION ALL
         SELECT ('opportunity-'::text || o.id),
            'opportunity'::text AS action_type,
            'customer'::text AS person_type,
            (o.customer_id)::bigint AS person_id,
            COALESCE(p3.display_name, ('客户#'::text || o.customer_id)) AS person_name,
            ((o.opportunity_type || '机会跟进 · '::text) || COALESCE(p3.display_name, ('客户#'::text || o.customer_id))) AS title,
            COALESCE(NULLIF(btrim(o.next_action), ''::text), NULLIF(btrim(o.last_progress), ''::text)) AS next_action,
            o.next_action_date AS action_date,
            NULL::text AS priority,
            'opportunities'::text AS source,
            o.status AS stage,
            (o.next_action_date - CURRENT_DATE) AS days_until,
            ( SELECT max(f.followup_date) AS max
                   FROM followups f
                  WHERE ((f.customer_id = o.customer_id) AND (f.deleted_at IS NULL))) AS last_followup_date
           FROM ((opportunities o
             LEFT JOIN customers c3 ON (((c3."Id" = o.customer_id) AND (c3.deleted_at IS NULL))))
             LEFT JOIN persons p3 ON (((p3.id = c3.person_id) AND (p3.deleted_at IS NULL))))
          WHERE ((o.deleted_at IS NULL) AND (o.customer_id IS NOT NULL) AND (o.status <> ALL (ARRAY['成交'::text, '关闭'::text])))
        UNION ALL
         SELECT ('recruit-'::text || rc.id),
            'recruit'::text AS action_type,
            'recruit'::text AS person_type,
            rc.id AS person_id,
            COALESCE(p4.display_name, ('候选人#'::text || rc.id)) AS person_name,
            (((('增员推进 · '::text || COALESCE(p4.display_name, ('候选人#'::text || rc.id))) || '（'::text) || rc.stage) || '）'::text) AS title,
            NULLIF(btrim(rc.next_action), ''::text) AS next_action,
            rc.next_action_date AS action_date,
            NULL::text AS priority,
            'recruit_candidates'::text AS source,
            rc.stage,
            (rc.next_action_date - CURRENT_DATE) AS days_until,
            ( SELECT max(rf.followup_date) AS max
                   FROM recruit_followups rf
                  WHERE ((rf.candidate_id = rc.id) AND (rf.deleted_at IS NULL))) AS last_followup_date
           FROM ((recruit_candidates rc
             JOIN customers c4 ON (((c4."Id" = rc.customer_id) AND (c4.deleted_at IS NULL))))
             LEFT JOIN persons p4 ON (((p4.id = c4.person_id) AND (p4.deleted_at IS NULL))))
          WHERE ((rc.deleted_at IS NULL) AND (rc.stage <> '流失'::text) AND ((NULLIF(btrim(rc.next_action), ''::text) IS NOT NULL) OR (rc.next_action_date IS NOT NULL)))
        UNION ALL
         SELECT ('recruit_followup-'::text || lr.id),
            'recruit_followup'::text AS action_type,
            'recruit'::text AS person_type,
            lr.candidate_id AS person_id,
            COALESCE(p5.display_name, ('候选人#'::text || lr.candidate_id)) AS person_name,
            ('增员跟进 · '::text || COALESCE(p5.display_name, ('候选人#'::text || lr.candidate_id))) AS title,
            COALESCE(NULLIF(btrim(lr.next_action), ''::text), NULLIF(btrim(lr.interaction_summary), ''::text), NULLIF(btrim(lr.next_followup_goal), ''::text)) AS next_action,
            COALESCE(lr.next_action_date, lr.next_followup_date) AS action_date,
            NULL::text AS priority,
            'recruit_followups'::text AS source,
            rc5.stage,
            (COALESCE(lr.next_action_date, lr.next_followup_date) - CURRENT_DATE) AS days_until,
            lr.followup_date AS last_followup_date
           FROM (((( SELECT DISTINCT ON (rf.candidate_id) rf.id,
                    rf.candidate_id,
                    rf.followup_date,
                    rf.next_action,
                    rf.next_action_date,
                    rf.next_followup_date,
                    rf.next_followup_goal,
                    rf.interaction_summary
                   FROM recruit_followups rf
                  WHERE ((rf.deleted_at IS NULL) AND ((rf.next_action_date IS NOT NULL) OR (rf.next_followup_date IS NOT NULL) OR (NULLIF(btrim(rf.next_action), ''::text) IS NOT NULL)))
                  ORDER BY rf.candidate_id, rf.followup_date DESC, rf.id DESC) lr
             JOIN recruit_candidates rc5 ON (((rc5.id = lr.candidate_id) AND (rc5.deleted_at IS NULL))))
             LEFT JOIN customers c5 ON (((c5."Id" = rc5.customer_id) AND (c5.deleted_at IS NULL))))
             LEFT JOIN persons p5 ON (((p5.id = c5.person_id) AND (p5.deleted_at IS NULL))))
        UNION ALL
         SELECT ('activity_task-'::text || t.id),
            'activity_task'::text AS action_type,
            'activity'::text AS person_type,
            t.activity_id AS person_id,
            COALESCE(a.name, ('活动#'::text || t.activity_id)) AS person_name,
            ((COALESCE(a.name, ('活动#'::text || t.activity_id)) || ' · '::text) || t.task_title) AS title,
            COALESCE(NULLIF(btrim(t.note), ''::text), t.task_title) AS next_action,
            t.due_date AS action_date,
            t.priority,
            'activity_tasks'::text AS source,
            t.status AS stage,
            (t.due_date - CURRENT_DATE) AS days_until,
            NULL::date AS last_followup_date
           FROM (activity_tasks t
             LEFT JOIN activities a ON (((a.id = t.activity_id) AND (a.deleted_at IS NULL))))
          WHERE ((t.status = ANY (ARRAY['pending'::text, 'in_progress'::text])) AND (a.deleted_at IS NULL))) v;

-- v_recruit_candidates
CREATE OR REPLACE VIEW public.v_recruit_candidates AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.gender,
    p.birthday,
    p.phone,
    p.wechat AS wx_account,
    p.occupation,
    c.annual_income,
    p.education,
    c.mbti,
    c.source,
    c.marital_status,
    c.hobbies,
    c.additional_info,
    rc.recommender_id,
    rc.stage,
    rc.stage_changed_at,
    rc.potential_score,
    rc.potential_reason,
    rc.motivation,
    rc.concerns,
    rc.work_experience,
    rc.family_situation,
    rc.personality_tags,
    rc.career_plan,
    rc.next_action_date,
    rc.next_action,
    rc.activity_history,
    rc.radar_image_file_id,
    rc.radar_image_name,
    rc.winner_report_file_id,
    rc.winner_report_name,
    rc.operator,
    rc.created_at,
    rc.updated_at,
        CASE
            WHEN (rc.stage_changed_at IS NOT NULL) THEN (EXTRACT(day FROM (now() - rc.stage_changed_at)))::integer
            ELSE NULL::integer
        END AS idle_days,
    rc.profile,
    rc.person_id
   FROM ((recruit_candidates rc
     LEFT JOIN customers c ON (((c."Id" = rc.customer_id) AND (c.deleted_at IS NULL))))
     LEFT JOIN persons p ON (((p.id = rc.person_id) AND (p.deleted_at IS NULL))))
  WHERE (rc.deleted_at IS NULL);

-- v_recruit_candidates_person_only
CREATE OR REPLACE VIEW public.v_recruit_candidates_person_only AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.gender,
    p.birthday,
    p.phone,
    p.wechat AS wx_account,
    p.occupation,
    c.annual_income,
    p.education,
    c.mbti,
    COALESCE(c.source, p.source) AS source,
    c.marital_status,
    c.hobbies,
    c.additional_info,
    rc.recommender_id,
    rc.stage,
    rc.stage_changed_at,
    rc.potential_score,
    rc.potential_reason,
    rc.motivation,
    rc.concerns,
    rc.work_experience,
    rc.family_situation,
    rc.personality_tags,
    rc.career_plan,
    rc.next_action_date,
    rc.next_action,
    rc.activity_history,
    rc.radar_image_file_id,
    rc.radar_image_name,
    rc.winner_report_file_id,
    rc.winner_report_name,
    rc.operator,
    rc.created_at,
    rc.updated_at,
        CASE
            WHEN (rc.stage_changed_at IS NOT NULL) THEN (EXTRACT(day FROM (now() - rc.stage_changed_at)))::integer
            ELSE NULL::integer
        END AS idle_days,
    rc.profile,
    rc.person_id
   FROM ((recruit_candidates rc
     JOIN persons p ON (((p.id = rc.person_id) AND (p.deleted_at IS NULL))))
     LEFT JOIN customers c ON ((c."Id" = rc.customer_id)))
  WHERE ((rc.deleted_at IS NULL) AND (rc.customer_id IS NULL));

-- v_recruit_candidates_person_only_trash
CREATE OR REPLACE VIEW public.v_recruit_candidates_person_only_trash AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.phone,
    p.occupation,
    rc.stage,
    rc.operator,
    rc.created_at,
    rc.updated_at,
    rc.deleted_at AS candidate_deleted_at,
    c.deleted_at AS customer_deleted_at,
    rc.person_id
   FROM ((recruit_candidates rc
     JOIN persons p ON ((p.id = rc.person_id)))
     LEFT JOIN customers c ON ((c."Id" = rc.customer_id)))
  WHERE ((rc.deleted_at IS NOT NULL) AND (rc.customer_id IS NULL));

-- v_recruit_candidates_trash
CREATE OR REPLACE VIEW public.v_recruit_candidates_trash AS
 SELECT rc.id AS candidate_id,
    rc.customer_id,
    p.display_name AS customer_name,
    p.phone,
    p.occupation,
    rc.stage,
    rc.operator,
    rc.created_at,
    rc.updated_at,
    rc.deleted_at AS candidate_deleted_at,
    c.deleted_at AS customer_deleted_at,
    rc.person_id
   FROM ((recruit_candidates rc
     LEFT JOIN customers c ON ((c."Id" = rc.customer_id)))
     LEFT JOIN persons p ON (((p.id = rc.person_id) AND (p.deleted_at IS NULL))))
  WHERE (rc.deleted_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.crm_customers_page_v1(p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_keyword text DEFAULT ''::text, p_sort_field text DEFAULT 'Id'::text, p_sort_dir text DEFAULT 'desc'::text, p_today date DEFAULT NULL::date, p_exact_name text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  local_today date := COALESCE(p_today, (now() AT TIME ZONE 'Asia/Shanghai')::date);
  result jsonb;
BEGIN
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000
    OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 1000
    OR p_sort_field IS NULL OR p_sort_field NOT IN
      ('Id', 'customer_name', 'sales_priority', 'latest_followup_date', 'next_followup_date', 'wb_status')
    OR p_sort_dir IS NULL OR p_sort_dir NOT IN ('asc', 'desc')
    OR p_keyword IS NULL OR p_today IS NOT NULL AND p_today NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'
  THEN
    RAISE EXCEPTION 'Invalid customer page criteria' USING ERRCODE = '22023';
  END IF;

  -- PMC-19 CL-02: customers 副本列已退出，基础字段直接从 persons 读取
  WITH base AS (
    SELECT c."Id",
      p.display_name AS customer_name,
      p.phone,
      p.occupation,
      p.birthday,
      p.gender,
      c.customer_stage, c.sales_priority, c.recruitment_priority, c.referral_priority,
      c.first_contact_date, c.marital_status, c.hobbies, c.source,
      c.tags, c.annual_income, c.household_income, c.properties_info,
      c.additional_info, c.created_at, c.updated_at,
      f.followup_date AS latest_followup_date,
      f.next_followup_date,
      COALESCE(f.followup_date, c.first_contact_date,
        (c.created_at AT TIME ZONE 'UTC')::date) AS last_contact_date
    FROM public.customers c
    LEFT JOIN public.persons p ON p.id = c.person_id
    LEFT JOIN LATERAL (
      SELECT x.followup_date, x.next_followup_date
      FROM public.followups x
      WHERE x.customer_id = c."Id" AND x.deleted_at IS NULL
      ORDER BY x.followup_date DESC NULLS LAST, x."Id" DESC
      LIMIT 1
    ) f ON true
    WHERE c.deleted_at IS NULL
      AND (p_exact_name IS NULL OR lower(btrim(p.display_name)) = lower(btrim(p_exact_name)))
      AND (btrim(p_keyword) = '' OR
        strpos(lower(COALESCE(p.display_name, '')), lower(btrim(p_keyword))) > 0 OR
        strpos(COALESCE(p.phone, ''), btrim(p_keyword)) > 0 OR
        strpos(lower(COALESCE(p.occupation, '')), lower(btrim(p_keyword))) > 0)
  ), scored AS (
    SELECT base.*,
      CASE
        WHEN next_followup_date < local_today THEN 100000 - (local_today - next_followup_date)
        WHEN next_followup_date = local_today THEN 200000
        WHEN next_followup_date <= local_today + 30 THEN 300000 + (next_followup_date - local_today)
        WHEN last_contact_date IS NOT NULL AND local_today - last_contact_date >= 30
          THEN 400000 - (local_today - last_contact_date)
        WHEN next_followup_date IS NOT NULL THEN 500000 + (next_followup_date - local_today)
        ELSE 500000
      END AS wb_sort
    FROM base
  ), ordered AS (
    SELECT scored.*,
      row_number() OVER (ORDER BY
        CASE WHEN p_sort_field = 'Id' AND p_sort_dir = 'asc' THEN "Id" END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'Id' AND p_sort_dir = 'desc' THEN "Id" END DESC NULLS LAST,
        CASE WHEN p_sort_field = 'customer_name' AND p_sort_dir = 'asc' THEN lower(customer_name) END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'customer_name' AND p_sort_dir = 'desc' THEN lower(customer_name) END DESC NULLS LAST,
        CASE WHEN p_sort_field = 'sales_priority' AND p_sort_dir = 'asc' THEN lower(sales_priority::text) END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'sales_priority' AND p_sort_dir = 'desc' THEN lower(sales_priority::text) END DESC NULLS LAST,
        CASE WHEN p_sort_field = 'latest_followup_date' AND p_sort_dir = 'asc' THEN latest_followup_date END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'latest_followup_date' AND p_sort_dir = 'desc' THEN latest_followup_date END DESC NULLS LAST,
        CASE WHEN p_sort_field = 'next_followup_date' AND p_sort_dir = 'asc' THEN next_followup_date END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'next_followup_date' AND p_sort_dir = 'desc' THEN next_followup_date END DESC NULLS LAST,
        CASE WHEN p_sort_field = 'wb_status' AND p_sort_dir = 'asc' THEN wb_sort END ASC NULLS LAST,
        CASE WHEN p_sort_field = 'wb_status' AND p_sort_dir = 'desc' THEN wb_sort END DESC NULLS LAST,
        "Id" ASC) AS sort_rank
    FROM scored
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_row) - 'sort_rank' - 'wb_sort' - 'last_contact_date'
      ORDER BY page_row.sort_rank) FROM (
        SELECT * FROM ordered ORDER BY sort_rank
        LIMIT p_page_size OFFSET (p_page::bigint - 1) * p_page_size
      ) page_row), '[]'::jsonb),
    'total', (SELECT count(*) FROM base),
    'page', p_page,
    'pageSize', p_page_size
  ) INTO result;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_search_people_v1(p_template text, p_months integer DEFAULT 3, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  local_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  result jsonb;
BEGIN
  IF p_template IS NULL OR
     p_template NOT IN ('activity_no_followup', 'child_education_no_insurance', 'declining_priority')
     OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 12
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid CRM search criteria' USING ERRCODE = '22023';
  END IF;

  IF p_template = 'activity_no_followup' THEN
    WITH attendance AS (
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        ap.id AS participant_id, a.id AS activity_id, a.activity_date,
        ap.followup_status,
        row_number() OVER (PARTITION BY p.id ORDER BY a.activity_date DESC, ap.id DESC) AS rn
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
      JOIN public.activity_participants ap ON
        ap.canonical_person_id = p.id OR
        (ap.canonical_person_id IS NULL AND
          ((ap.person_type = 'person' AND ap.person_id = p.id)
           OR (ap.person_type = 'customer' AND ap.person_id = c."Id")
           OR (ap.person_type = 'recruit' AND EXISTS (
             SELECT 1 FROM public.recruit_candidates rc
             WHERE rc.id = ap.person_id AND rc.person_id = p.id AND rc.deleted_at IS NULL))))
      JOIN public.activities a ON a.id = ap.activity_id
      WHERE p.deleted_at IS NULL AND ap.deleted_at IS NULL AND a.deleted_at IS NULL
        AND ap.status = 'attended'
        AND a.activity_date >= (local_today - make_interval(months => p_months))::date
        AND a.activity_date <= local_today
        AND (c."Id" IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM public.customers cx WHERE cx.person_id = p.id))
    ), matched AS (
      SELECT x.* FROM attendance x WHERE x.rn = 1
        AND x.followup_status IS DISTINCT FROM 'done'
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = x.customer_id AND f.deleted_at IS NULL
            AND f.followup_date >= x.activity_date)
        AND NOT EXISTS (SELECT 1 FROM public.recruit_followups rf
          JOIN public.recruit_candidates rc ON rc.id = rf.candidate_id
          WHERE rc.person_id = x.person_id AND rc.deleted_at IS NULL
            AND rf.deleted_at IS NULL AND rf.followup_date >= x.activity_date)
        AND NOT EXISTS (SELECT 1 FROM public.interactions i
          WHERE i.person_id = x.person_id AND i.interaction_type <> 'attendance'
            AND (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date >= x.activity_date)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT person_id, display_name, customer_id, activity_id,
          participant_id, activity_date FROM matched
        ORDER BY activity_date DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'attended_participants',
        'rows', (SELECT count(*) FROM public.activity_participants ap
          JOIN public.activities a ON a.id = ap.activity_id
          WHERE ap.deleted_at IS NULL AND a.deleted_at IS NULL AND ap.status = 'attended'
            AND a.activity_date >= (local_today - make_interval(months => p_months))::date
            AND a.activity_date <= local_today))) INTO result;

  ELSIF p_template = 'child_education_no_insurance' THEN
    WITH matched AS (
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        child.member_id AS child_member_id, edu.source_table AS education_source_table,
        edu.source_id AS education_source_id, edu.observed_at AS education_date
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
      JOIN LATERAL (
        SELECT hm.id AS member_id FROM public.households h
        JOIN public.household_members hm ON hm.household_id = h.id
        WHERE h.deleted_at IS NULL AND hm.deleted_at IS NULL AND hm.confirmed_at IS NOT NULL
          AND ((h.anchor_person_id = p.id AND hm.relationship_to_anchor = 'child')
            OR (hm.person_id = p.id AND hm.relationship_to_anchor = 'parent'))
        ORDER BY hm.created_at DESC, hm.id DESC LIMIT 1
      ) child ON true
      JOIN LATERAL (
        SELECT source_table, source_id, observed_at FROM (
          SELECT 'followups'::text AS source_table, f."Id"::bigint AS source_id,
            f.followup_date AS observed_at
          FROM public.followups f WHERE f.customer_id = c."Id"
            AND f.deleted_at IS NULL
            AND f.followup_date >= (local_today - make_interval(months => p_months))::date
            AND concat_ws(' ', f.interaction_summary, f.followup_notes) ~ '(教育|学费|升学|学校)'
          UNION ALL
          SELECT 'interactions', i.id, (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date
          FROM public.interactions i WHERE i.person_id = p.id
            AND (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date
            AND concat_ws(' ', i.summary, i.raw_note) ~ '(教育|学费|升学|学校)'
          UNION ALL
          SELECT 'context_items', ci.id, (ci.created_at AT TIME ZONE 'Asia/Shanghai')::date
          FROM public.context_items ci WHERE ci.person_id = p.id AND ci.confirmed
            AND ci.category IN ('education', 'child_education')
            AND (ci.valid_to IS NULL OR ci.valid_to >= now())
            AND (ci.created_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date
        ) sources ORDER BY observed_at DESC, source_id DESC LIMIT 1
      ) edu ON true
      WHERE p.deleted_at IS NULL
        AND (c."Id" IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM public.customers cx WHERE cx.person_id = p.id))
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL
            AND concat_ws(' ', f.interaction_summary, f.followup_notes)
              ~ '(保险|保单|保障|寿险|重疾)')
        AND NOT EXISTS (SELECT 1 FROM public.interactions i
          WHERE i.person_id = p.id AND concat_ws(' ', i.summary, i.raw_note)
            ~ '(保险|保单|保障|寿险|重疾)')
        AND NOT EXISTS (SELECT 1 FROM public.context_items ci
          WHERE ci.person_id = p.id AND ci.confirmed
            AND ci.category IN ('insurance', 'coverage', 'policy')
            AND (ci.valid_to IS NULL OR ci.valid_to >= now()))
        AND NOT EXISTS (SELECT 1 FROM public.policy_review_reports prr
          WHERE prr.customer_id = c."Id" AND prr.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.products product
          WHERE product.customer_id = c."Id" AND product.deleted_at IS NULL)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT * FROM matched ORDER BY education_date DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'confirmed_child_members',
        'rows', (SELECT count(*) FROM public.household_members hm
          JOIN public.households h ON h.id = hm.household_id
          WHERE h.deleted_at IS NULL AND hm.deleted_at IS NULL
            AND hm.confirmed_at IS NOT NULL AND hm.relationship_to_anchor IN ('child', 'parent')))) INTO result;

  ELSE
    WITH matched AS (
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        c.sales_priority::text AS sales_priority,
        r.id AS relationship_id, r.from_person_id, r.to_person_id,
        r.trend, r.updated_at AS relationship_updated_at
      FROM public.persons p
      JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
      JOIN LATERAL (
        SELECT rel.id, rel.from_person_id, rel.to_person_id, rel.trend, rel.updated_at
        FROM public.relationships rel
        WHERE rel.deleted_at IS NULL AND rel.status = 'confirmed'
          AND (rel.from_person_id = p.id OR rel.to_person_id = p.id)
          AND lower(btrim(rel.trend)) IN ('declining', 'down', '下降', '走弱')
          AND (rel.updated_at AT TIME ZONE 'Asia/Shanghai')::date >=
            (local_today - make_interval(months => p_months))::date
        ORDER BY rel.updated_at DESC, rel.id DESC LIMIT 1
      ) r ON true
      WHERE p.deleted_at IS NULL AND c.sales_priority::text IN ('A', 'B')
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT * FROM matched ORDER BY relationship_updated_at DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'recent_declining_relationships',
        'rows', (SELECT count(*) FROM public.relationships r
          WHERE r.deleted_at IS NULL AND r.status = 'confirmed'
            AND lower(btrim(r.trend)) IN ('declining', 'down', '下降', '走弱')
            AND (r.updated_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date))) INTO result;
  END IF;

  RETURN result;
END;
$function$;

CREATE OR REPLACE VIEW public.v_funnel_stats WITH (security_invoker=true) AS
 WITH dim AS (
         SELECT 'customer'::text AS funnel,
            e.enumlabel::text AS stage,
            e.enumsortorder::integer AS stage_order,
            'active'::text AS kind
           FROM pg_catalog.pg_enum e
             JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = '客户经营阶段'::name
        UNION ALL
         SELECT 'customer'::text AS text,
            '未分层'::text AS text,
            0,
            'unclassified'::text AS text
        UNION ALL
         SELECT vopp.funnel,
            vopp.stage,
            vopp.stage_order,
            vopp.kind
           FROM ( VALUES ('opportunity'::text,'发现'::text,1,'active'::text), ('opportunity'::text,'沟通'::text,2,'active'::text), ('opportunity'::text,'方案'::text,3,'active'::text), ('opportunity'::text,'成交'::text,4,'terminal'::text), ('opportunity'::text,'关闭'::text,5,'terminal'::text)) vopp(funnel, stage, stage_order, kind)
        UNION ALL
         SELECT vrc.funnel,
            vrc.stage,
            vrc.stage_order,
            vrc.kind
           FROM ( VALUES ('recruit'::text,'新增人才'::text,1,'active'::text), ('recruit'::text,'互动暖客'::text,2,'active'::text), ('recruit'::text,'初次面谈'::text,3,'active'::text), ('recruit'::text,'增员活动'::text,4,'active'::text), ('recruit'::text,'精准面谈'::text,5,'active'::text), ('recruit'::text,'入职申请'::text,6,'active'::text), ('recruit'::text,'签约入司'::text,7,'terminal'::text)) vrc(funnel, stage, stage_order, kind)
        ), fact AS (
         SELECT 'customer'::text AS funnel,
            COALESCE(c.customer_stage::text, '未分层'::text) AS stage,
            count(*) AS current_count,
            count(*) FILTER (WHERE c.created_at >= (now() - '30 days'::interval)) AS entered_30d,
            NULL::bigint AS moved_30d,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM public.v_action_center a
                  WHERE a.person_type = 'customer'::text AND a.person_id = c."Id" AND a.status = 'overdue'::text))) AS overdue_count,
            NULL::integer AS dwell_median_days,
            NULL::bigint AS stuck_count
           FROM public.customers c
          WHERE c.deleted_at IS NULL
          GROUP BY (COALESCE(c.customer_stage::text, '未分层'::text))
        UNION ALL
         SELECT 'opportunity'::text AS text,
            o.status,
            count(*) AS count,
            count(*) FILTER (WHERE COALESCE(o.discovered_at, o.created_at::date) >= (CURRENT_DATE - 30)) AS count,
            NULL::bigint AS int8,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM public.v_action_center a
                  WHERE a.action_type = 'opportunity'::text AND a.person_id = o.id AND a.status = 'overdue'::text))) AS count,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY ((CURRENT_DATE - COALESCE(o.discovered_at, o.created_at::date))::double precision)) FILTER (WHERE o.status <> ALL (ARRAY['成交'::text, '关闭'::text]))::integer AS percentile_cont,
            count(*) FILTER (WHERE (o.status <> ALL (ARRAY['成交'::text, '关闭'::text])) AND (CURRENT_DATE - COALESCE(o.discovered_at, o.created_at::date)) >= 60) AS count
           FROM public.opportunities o
          WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL
          GROUP BY o.status
        UNION ALL
         SELECT 'recruit'::text AS text,
            rc.stage,
            count(*) AS count,
            count(*) FILTER (WHERE rc.created_at >= (now() - '30 days'::interval)) AS count,
            count(*) FILTER (WHERE rc.stage_changed_at >= (now() - '30 days'::interval) AND rc.created_at < (now() - '30 days'::interval)) AS count,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM public.v_action_center a
                  WHERE a.person_type = 'recruit'::text AND a.person_id = rc.id AND a.status = 'overdue'::text))) AS count,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY ((CURRENT_DATE - rc.stage_changed_at::date)::double precision)) FILTER (WHERE rc.stage <> '签约入司'::text AND rc.stage_changed_at IS NOT NULL)::integer AS percentile_cont,
            count(*) FILTER (WHERE (rc.stage <> ALL (ARRAY['签约入司'::text, '流失'::text])) AND (CURRENT_DATE - rc.stage_changed_at::date) >= 30) AS count
           FROM public.recruit_candidates rc
          WHERE rc.deleted_at IS NULL
          GROUP BY rc.stage
        ), extra AS (
         SELECT f.funnel,
            f.stage,
            (90 + row_number() OVER (PARTITION BY f.funnel ORDER BY f.stage))::integer AS stage_order,
                CASE
                    WHEN f.stage = ANY (ARRAY['流失'::text, '关闭'::text, '成交'::text]) THEN 'terminal'::text
                    ELSE 'other'::text
                END AS kind,
            f.current_count,
            f.entered_30d,
            f.moved_30d,
            f.overdue_count,
            f.dwell_median_days,
            f.stuck_count
           FROM fact f
          WHERE NOT (EXISTS ( SELECT 1
                   FROM dim d
                  WHERE d.funnel = f.funnel AND d.stage = f.stage))
        )
 SELECT d.funnel,
    d.stage,
    d.stage_order,
    d.kind,
    COALESCE(f.current_count, 0::bigint) AS current_count,
    COALESCE(f.entered_30d, 0::bigint) AS entered_30d,
    f.moved_30d,
    COALESCE(f.overdue_count, 0::bigint) AS overdue_count,
    f.dwell_median_days,
    f.stuck_count
   FROM dim d
     LEFT JOIN fact f ON f.funnel = d.funnel AND f.stage = d.stage
UNION ALL
 SELECT e.funnel,
    e.stage,
    e.stage_order,
    e.kind,
    e.current_count,
    e.entered_30d,
    e.moved_30d,
    e.overdue_count,
    e.dwell_median_days,
    e.stuck_count
   FROM extra e
  ORDER BY 1, 3;



ALTER VIEW public.ai_recommendations_view SET (security_invoker=true);
ALTER VIEW public.customers_view SET (security_invoker=true);
ALTER VIEW public.followups_view SET (security_invoker=true);
ALTER VIEW public.gifts_view SET (security_invoker=true);
ALTER VIEW public.photos_view SET (security_invoker=true);
ALTER VIEW public.products_view SET (security_invoker=true);
ALTER VIEW public.v_action_center SET (security_invoker=true);
ALTER VIEW public.v_funnel_stats SET (security_invoker=true);
ALTER VIEW public.v_recruit_candidates SET (security_invoker=true);
ALTER VIEW public.v_recruit_candidates_person_only SET (security_invoker=true);
ALTER VIEW public.v_recruit_candidates_person_only_trash SET (security_invoker=true);
ALTER VIEW public.v_recruit_candidates_trash SET (security_invoker=true);
CREATE OR REPLACE FUNCTION public.person_identity_execute_v1(p_actor_uid text, p_preview_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_cmd public.person_identity_commands%ROWTYPE;v_person public.persons%ROWTYPE;
  v_name_key text;v_fingerprint text;v_customer_id bigint;v_recruit_id bigint;
  v_speaker_id bigint;v_interaction_id bigint;v_result jsonb;v_parent_id text;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cmd FROM public.person_identity_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preview not found for this account'; END IF;
  IF v_cmd.status='executed' THEN RETURN v_cmd.result; END IF;
  IF v_cmd.expires_at<=now() THEN RAISE EXCEPTION 'Preview expired'; END IF;
  v_name_key:=v_cmd.payload->>'name_key';
  PERFORM pg_advisory_xact_lock(hashtextextended(v_name_key,0));
  SELECT md5(coalesce(string_agg(id::text||':'||updated_at::text,',' ORDER BY id),''))
    INTO v_fingerprint FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL;
  IF v_fingerprint<>v_cmd.candidate_fingerprint THEN
    RAISE EXCEPTION 'Identity candidates changed; preview again'; END IF;
  IF v_cmd.payload ? 'person_id' AND nullif(v_cmd.payload->>'person_id','') IS NOT NULL THEN
    SELECT * INTO v_person FROM public.persons
      WHERE id=(v_cmd.payload->>'person_id')::bigint AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.display_name<>v_cmd.payload->>'display_name'
       OR v_person.name_key<>v_name_key THEN
      RAISE EXCEPTION 'Selected Person changed; preview again'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
      AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Deleted identity requires manual review'; END IF;
    IF EXISTS (SELECT 1 FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL)
       AND ((v_cmd.payload->>'display_name') !~ '(（[^（）]+）|\([^()]+\))$'
         OR EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
            AND deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Same-name Person changed; preview again'; END IF;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
       AND position('【系统测试·勿联系】' IN (v_cmd.payload->>'display_name'))=0 THEN
      RAISE EXCEPTION 'Test account must use fictional marked Person'; END IF;
    INSERT INTO public.persons(display_name,name_key,occupation,organization,education,source)
      VALUES(v_cmd.payload->>'display_name',v_name_key,
        nullif(v_cmd.payload->>'occupation',''),nullif(v_cmd.payload->>'organization',''),
        nullif(v_cmd.payload->>'education',''),
        coalesce(nullif(v_cmd.payload->>'source',''),'人工新增')) RETURNING * INTO v_person;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) THEN
      SELECT record_id INTO v_parent_id FROM public.crm_test_records
        WHERE batch_key='crm_test_main_v1' AND record_table='persons'
        ORDER BY created_at LIMIT 1;
      IF v_parent_id IS NULL THEN RAISE EXCEPTION 'Test parent Person is missing'; END IF;
      INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
        parent_table,parent_id,visible_label)
      VALUES('crm_test_main_v1','persons',v_person.id::text,'derived',
        'persons',v_parent_id,'【系统测试·勿联系】WP07.1 人工新增人物');
    END IF;
  END IF;
  -- PMC-19 CL-02: query customer by person_id (customers 副本列已退出)
  SELECT "Id" INTO v_customer_id FROM public.customers
    WHERE person_id=v_person.id AND deleted_at IS NULL;
  IF v_customer_id IS NULL AND EXISTS (SELECT 1 FROM public.customers
    WHERE person_id=v_person.id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Customer is in recycle bin; restore it first'; END IF;
  IF v_cmd.kind='customer' OR
     (v_cmd.kind='capture' AND coalesce((v_cmd.payload->>'customer')::boolean,false)) THEN
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers(source,person_id)
      VALUES('Person 角色转换',v_person.id)
      RETURNING "Id" INTO v_customer_id;
      IF EXISTS(SELECT 1 FROM public.crm_test_records
        WHERE record_table='persons' AND record_id=v_person.id::text) THEN
        INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
          parent_table,parent_id,visible_label)
        SELECT batch_key,'customers',v_customer_id::text,'derived','persons',
          v_person.id::text,'【系统测试·勿联系】WP07.1 转客户'
        FROM public.crm_test_records WHERE record_table='persons'
          AND record_id=v_person.id::text ON CONFLICT DO NOTHING;
      END IF;
      UPDATE public.recruit_candidates SET customer_id=v_customer_id,updated_at=now()
        WHERE person_id=v_person.id AND customer_id IS NULL AND deleted_at IS NULL;
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'customer','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind='recruit' THEN
    SELECT id INTO v_recruit_id FROM public.recruit_candidates
      WHERE person_id=v_person.id AND deleted_at IS NULL;
    IF v_recruit_id IS NULL THEN
      INSERT INTO public.recruit_candidates(person_id,customer_id,stage,stage_changed_at)
      VALUES(v_person.id,v_customer_id,'新增人才',now()) RETURNING id INTO v_recruit_id;
      INSERT INTO public.recruit_milestones(candidate_id,from_stage,to_stage,note)
        VALUES(v_recruit_id,NULL,'新增人才','人工转增员');
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'recruit','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind IN ('speaker','capture') THEN
    IF v_cmd.kind='speaker' OR coalesce((v_cmd.payload->>'speaker')::boolean,false) THEN
      IF v_cmd.payload ? 'speaker_id' THEN
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE id=(v_cmd.payload->>'speaker_id')::bigint AND deleted_at IS NULL
            AND name=v_person.display_name AND customer_id IS NULL
            AND (person_id IS NULL OR person_id=v_person.id) FOR UPDATE;
        IF v_speaker_id IS NULL THEN RAISE EXCEPTION 'Speaker profile changed; preview again'; END IF;
        UPDATE public.activity_speakers SET person_id=v_person.id,customer_id=v_customer_id,
          updated_at=now() WHERE id=v_speaker_id AND person_id IS NULL;
        IF v_cmd.kind='capture' THEN
          UPDATE public.activity_speakers SET last_contact_date=current_date,
            last_contact_note='【快速记录】'||(v_cmd.payload->>'note'),
            next_contact_date=nullif(v_cmd.payload->>'next_contact_date','')::date,
            updated_at=now() WHERE id=v_speaker_id;
        END IF;
      ELSE
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE person_id=v_person.id AND deleted_at IS NULL ORDER BY id LIMIT 1;
      END IF;
      IF v_speaker_id IS NULL THEN
        INSERT INTO public.activity_speakers(name,person_id,customer_id,source,
          last_contact_date,last_contact_note,next_contact_date)
          VALUES(v_person.display_name,v_person.id,v_customer_id,'快速记录',
            CASE WHEN v_cmd.kind='capture' THEN current_date ELSE NULL END,
            CASE WHEN v_cmd.kind='capture' THEN '【快速记录】'||(v_cmd.payload->>'note') ELSE NULL END,
            nullif(v_cmd.payload->>'next_contact_date','')::date)
          RETURNING id INTO v_speaker_id;
      END IF;
      INSERT INTO public.person_roles(person_id,role,origin)
        VALUES(v_person.id,'speaker','manual') ON CONFLICT(person_id,role) DO NOTHING;
    END IF;
  END IF;
  IF v_cmd.kind='capture' THEN
    IF length(btrim(coalesce(v_cmd.payload->>'note','')))=0
       OR length(v_cmd.payload->>'note')>10000 THEN
      RAISE EXCEPTION 'Invalid quick capture note'; END IF;
    INSERT INTO public.interactions(person_id,interaction_type,interaction_at,
      summary,raw_note,source_type,created_by_uid)
    VALUES(v_person.id,'交流',coalesce((v_cmd.payload->>'interaction_at')::timestamptz,now()),
      left(coalesce(nullif(v_cmd.payload->>'summary',''),v_cmd.payload->>'note'),2000),
      v_cmd.payload->>'note','manual',p_actor_uid) RETURNING id INTO v_interaction_id;
  END IF;
  v_result:=jsonb_build_object('personId',v_person.id,'customerId',v_customer_id,
    'recruitId',v_recruit_id,'speakerId',v_speaker_id,'interactionId',v_interaction_id,
    'replayed',false);
  UPDATE public.person_identity_commands SET status='executed',result=v_result,
    executed_at=now() WHERE id=v_cmd.id;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_test_scenario_v1(p_stage text, p_actor_uid text, p_preview_id uuid DEFAULT NULL::uuid, p_preview_hash text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
DECLARE batch constant text := 'crm_test_main_v1'; marker constant text := '【系统测试·勿联系】';
 person_name constant text := '【系统测试·勿联系】虚构体验甲'; today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
 total_initial integer; own_initial integer; plan jsonb; fingerprint text; token public.crm_test_previews%ROWTYPE;
 customer_id integer; person_id bigint; role_customer bigint; role_participant bigint; followup_id integer;
 interaction_id bigint; opportunity_id bigint; action_id bigint; activity_id bigint; participant_id bigint;
 item record; exists_row boolean; targets jsonb; result jsonb; trigger_hash text;
BEGIN
 IF p_stage IS NULL OR p_stage NOT IN ('status','dryRun','confirm','execute') OR nullif(btrim(p_actor_uid),'') IS NULL OR length(p_actor_uid)>128 THEN
  RAISE EXCEPTION 'Invalid scenario request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(20261003,3);
 SELECT count(*),count(*) FILTER(WHERE batch_key=batch) INTO total_initial,own_initial FROM public.crm_test_records WHERE origin='initial';
 IF total_initial>10 OR own_initial NOT IN (0,10) THEN RAISE EXCEPTION 'Invalid initial manifest' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_object_agg(seed_key,record_id),'{}') INTO targets FROM public.crm_test_records WHERE batch_key=batch AND origin='initial';
 FOR item IN SELECT record_table,record_id FROM public.crm_test_records WHERE batch_key=batch AND origin='initial' LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text=$1)',item.record_table,CASE WHEN item.record_table IN ('customers','followups') THEN 'Id' ELSE 'id' END) INTO exists_row USING item.record_id;
  IF NOT exists_row THEN RAISE EXCEPTION 'A seed row is missing; restoration requires review' USING ERRCODE='23514'; END IF;
 END LOOP;
 result := jsonb_build_object('ok',true,'batchKey',batch,'initialCount',total_initial,'ready',own_initial=10,
  'derivedCount',(SELECT count(*) FROM public.crm_test_records WHERE batch_key=batch AND origin='derived'),
  'auditCount',(SELECT count(*) FROM public.crm_test_records WHERE batch_key=batch AND origin='ai_audit'),
  'targets',jsonb_build_object('personId',targets->>'person','customerId',targets->>'customer','activityId',targets->>'activity'),
  'marker',marker,'outbound',false);
 IF p_stage='status' THEN RETURN result; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
   AND c.relname IN ('persons','customers','person_roles','followups','interactions','opportunities','actions','activities','activity_participants')
   AND NOT (t.tgname='zz_crm_test_track' AND t.tgfoid='public.crm_test_track_v1()'::regprocedure
    OR c.relname='actions' AND t.tgname='actions_guard_before_write' AND md5(pg_get_functiondef(t.tgfoid))='3d9721447fc893d76f4d08dc57cb39a7'
    OR c.relname='activity_participants' AND t.tgname='activity_participants_canonical_guard_trigger' AND md5(pg_get_functiondef(t.tgfoid))='34fdfcd27872433edd2b10b9e84ff876')
 ) THEN RAISE EXCEPTION 'Unreviewed seed trigger; dry-run counts require review' USING ERRCODE='23514'; END IF;
 IF own_initial=0 AND total_initial+10>10 THEN RAISE EXCEPTION 'Initial limit exceeded' USING ERRCODE='23514'; END IF;
 -- PMC-19 CL-02: identity collision check via persons JOIN (customer_name column removed)
 IF EXISTS(SELECT 1 FROM public.persons p WHERE p.name_key=lower(person_name) AND p.id::text IS DISTINCT FROM targets->>'person')
   OR EXISTS(SELECT 1 FROM public.customers c JOIN public.persons p ON c.person_id=p.id
             WHERE p.display_name=person_name AND c."Id"::text IS DISTINCT FROM targets->>'customer') THEN
  RAISE EXCEPTION 'Identity collision; never reuse an unregistered person' USING ERRCODE='23514'; END IF;
 SELECT md5(coalesce(string_agg(pg_get_triggerdef(t.oid)||pg_get_functiondef(t.tgfoid),'|' ORDER BY c.relname,t.tgname),'')) INTO trigger_hash
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN ('persons','customers','person_roles','followups','interactions','opportunities','actions','activities','activity_participants');
 plan := jsonb_build_object('batchKey',batch,'version',1,'personName',person_name,'date',today,
  'initialExisting',total_initial,'initialNew',CASE WHEN own_initial=10 THEN 0 ELSE 10 END,
  'initialTotal',CASE WHEN own_initial=10 THEN total_initial ELSE total_initial+10 END,'maximum',10,
  'triggerBusinessRows',0,'outbound',false,'triggerHash',trigger_hash,
  'rows','[{"table":"persons","count":1},{"table":"customers","count":1},{"table":"person_roles","count":2},{"table":"followups","count":1},{"table":"interactions","count":1},{"table":"opportunities","count":1},{"table":"actions","count":1},{"table":"activities","count":1},{"table":"activity_participants","count":1}]'::jsonb);
 fingerprint := md5(plan::text);
 IF p_stage='dryRun' THEN
  INSERT INTO public.crm_test_previews(actor_uid,batch_key,preview,preview_hash) VALUES(p_actor_uid,batch,plan,fingerprint) RETURNING * INTO token;
  RETURN result || jsonb_build_object('stage','dryRun','previewId',token.id,'previewHash',fingerprint,'expiresAt',token.expires_at,'preview',plan,'businessDataWritten',false);
 END IF;
 SELECT * INTO token FROM public.crm_test_previews WHERE id=p_preview_id AND actor_uid=p_actor_uid AND batch_key=batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
 IF p_stage='execute' AND token.executed_at IS NOT NULL THEN RETURN result || jsonb_build_object('stage','execute','replayed',true,'businessDataWritten',false); END IF;
 IF token.expires_at<=now() OR token.preview_hash<>fingerprint THEN RAISE EXCEPTION 'Preview is stale' USING ERRCODE='40001'; END IF;
 IF p_stage='confirm' THEN
  IF p_preview_hash IS DISTINCT FROM token.preview_hash THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
  UPDATE public.crm_test_previews SET confirmed_at=now() WHERE id=token.id;
  RETURN result || jsonb_build_object('stage','confirm','businessDataWritten',false);
 END IF;
 IF token.confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
 IF own_initial=0 THEN
  INSERT INTO public.crm_test_batches(batch_key,created_by_uid) VALUES(batch,p_actor_uid);
  PERFORM set_config('crm.test_initial_batch',batch,true);
  INSERT INTO public.persons(display_name,name_key,source,notes)
   VALUES(person_name,lower(person_name),batch,marker||'纯虚构身份') RETURNING id INTO person_id;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'customer','manual') RETURNING id INTO role_customer;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'participant','manual') RETURNING id INTO role_participant;
  -- PMC-19 CL-02: customers 副本列已退出，仅写 person_id + 业务列
  INSERT INTO public.customers(person_id,source,additional_info,next_action,next_action_date,first_contact_date)
   VALUES(person_id,batch,marker||'纯虚构，无联系方式，无保单',marker||'核对测试场景',today,today-2) RETURNING "Id" INTO customer_id;
  INSERT INTO public.followups(customer_id,customer_name,followup_notes,followup_date,next_followup_date,next_followup_goal,created_at)
   VALUES(customer_id,person_name,marker||'活动前的虚构沟通',today-2,today,marker||'仅在系统内记录测试结果',now()) RETURNING "Id" INTO followup_id;
  INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,source_type,created_by_uid)
   VALUES(person_id,'conversation',(today-2)::timestamp AT TIME ZONE 'Asia/Shanghai',marker||'活动前的虚构互动','manual',p_actor_uid) RETURNING id INTO interaction_id;
  INSERT INTO public.opportunities(customer_id,person_id,opportunity_type,status,discovered_at,last_progress,next_action,next_action_date)
   VALUES(customer_id,person_id,'其他','发现',today,marker||'虚构机会，无真实保单',marker||'核对虚构机会',today) RETURNING id INTO opportunity_id;
  INSERT INTO public.actions(person_id,opportunity_id,interaction_id,action_type,title,description,due_at,source,created_by_uid)
   VALUES(person_id,opportunity_id,interaction_id,'other',marker||'核对体验流程',marker||'仅系统内测试，不联系不外发',
    (today::timestamp + interval '18 hours') AT TIME ZONE 'Asia/Shanghai',batch,p_actor_uid) RETURNING id INTO action_id;
  INSERT INTO public.activities(name,activity_date,activity_type,description,status)
   VALUES(marker||'虚构体验活动',today,'其他',marker||'虚构到场场景，不发通知','ended') RETURNING id INTO activity_id;
  INSERT INTO public.activity_participants(activity_id,person_type,person_id,canonical_person_id,person_name,status,followup_status,relationship_note)
   VALUES(activity_id,'person',person_id,person_id,person_name,'attended','none',marker||'虚构到场记录') RETURNING id INTO participant_id;
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,initial_slot,seed_key,visible_label)
   SELECT batch,t,id::text,'initial',slot,key,marker||label FROM (VALUES
    ('customers',customer_id::bigint,1::smallint,'customer','客户'),('persons',person_id,2,'person','人物'),
    ('person_roles',role_customer,3,'customer_role','客户角色'),('person_roles',role_participant,4,'participant_role','参与者角色'),
    ('followups',followup_id,5,'followup','跟进'),('interactions',interaction_id,6,'interaction','互动'),
    ('opportunities',opportunity_id,7,'opportunity','机会'),('actions',action_id,8,'action','行动'),
    ('activities',activity_id,9,'activity','活动'),('activity_participants',participant_id,10,'participant','到场')) AS v(t,id,slot,key,label);
  PERFORM set_config('crm.test_initial_batch','',true);
 END IF;
 UPDATE public.crm_test_previews SET executed_at=now() WHERE id=token.id;
 RETURN public.crm_test_scenario_v1('status',p_actor_uid) || jsonb_build_object('stage','execute','replayed',own_initial=10,'businessDataWritten',own_initial=0);
END
$function$;


COMMIT;
