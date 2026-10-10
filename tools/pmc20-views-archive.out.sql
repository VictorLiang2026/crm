-- PMC-19 CL-02 (archived by PMC-20): rebuild the 11 views that used to read base
-- identity columns from customers (customer_name/phone/birthday/gender/occupation/
-- education/wx_account). After CL-02 they read those columns from persons via
-- customers.person_id. Executed 2026-10-10 before the customer copy columns were dropped.
-- Source of this file: live pg_views export taken 2026-10-10 (tools/pmc20-export-views.sql).
-- Security options (e.g. security_invoker) are view-level and survive CREATE OR REPLACE.

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
