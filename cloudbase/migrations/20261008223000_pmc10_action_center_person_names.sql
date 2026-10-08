-- PMC-10: v_action_center 展示姓名切换——person_name/title 经 persons.display_name COALESCE
-- 列名、顺序、类型不变（CREATE OR REPLACE 兼容修改，不删对象）；统计口径、排序、过滤条件全部不变
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.v_action_center') IS NULL THEN
    RAISE EXCEPTION 'public.v_action_center does not exist';
  END IF;
END $guard$;

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
            COALESCE(p.display_name, c.customer_name) AS person_name,
            '客户经营 · '::text || COALESCE(p.display_name, c.customer_name) AS title,
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
             LEFT JOIN public.persons p ON p.id = c.person_id AND p.deleted_at IS NULL
          WHERE c.deleted_at IS NULL AND (NULLIF(btrim(c.next_action), ''::text) IS NOT NULL OR c.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'followup-'::text || lf."Id",
            'followup'::text AS action_type,
            'customer'::text AS person_type,
            lf.customer_id::bigint AS person_id,
            COALESCE(p2.display_name, lf.customer_name) AS person_name,
            '跟进回访 · '::text || COALESCE(p2.display_name, lf.customer_name) AS title,
            COALESCE(NULLIF(btrim(lf.next_action), ''::text), NULLIF(btrim(lf.interaction_summary), ''::text), lf.next_followup_goal) AS next_action,
            COALESCE(lf.next_action_date, lf.next_followup_date) AS action_date,
            NULL::text AS priority,
            'followups'::text AS source,
            c2.customer_stage::text AS stage,
            COALESCE(lf.next_action_date, lf.next_followup_date) - CURRENT_DATE AS days_until,
            lf.followup_date AS last_followup_date
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
             LEFT JOIN public.persons p2 ON p2.id = c2.person_id AND p2.deleted_at IS NULL
        UNION ALL
         SELECT 'opportunity-'::text || o.id,
            'opportunity'::text AS action_type,
            'customer'::text AS person_type,
            o.customer_id::bigint AS person_id,
            COALESCE(p3.display_name, c3.customer_name, '客户#'::text || o.customer_id) AS person_name,
            (o.opportunity_type || '机会跟进 · '::text) || COALESCE(p3.display_name, c3.customer_name, '客户#'::text || o.customer_id) AS title,
            COALESCE(NULLIF(btrim(o.next_action), ''::text), NULLIF(btrim(o.last_progress), ''::text)) AS next_action,
            o.next_action_date AS action_date,
            NULL::text AS priority,
            'opportunities'::text AS source,
            o.status AS stage,
            o.next_action_date - CURRENT_DATE AS days_until,
            ( SELECT max(f.followup_date) AS max
                   FROM public.followups f
                  WHERE f.customer_id = o.customer_id AND f.deleted_at IS NULL) AS last_followup_date
           FROM public.opportunities o
             LEFT JOIN public.customers c3 ON c3."Id" = o.customer_id AND c3.deleted_at IS NULL
             LEFT JOIN public.persons p3 ON p3.id = c3.person_id AND p3.deleted_at IS NULL
          WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL AND (o.status <> ALL (ARRAY['成交'::text, '关闭'::text]))
        UNION ALL
         SELECT 'recruit-'::text || rc.id,
            'recruit'::text AS action_type,
            'recruit'::text AS person_type,
            rc.id AS person_id,
            COALESCE(p4.display_name, c4.customer_name) AS person_name,
            ((('增员推进 · '::text || COALESCE(p4.display_name, c4.customer_name)) || '（'::text) || rc.stage) || '）'::text AS title,
            NULLIF(btrim(rc.next_action), ''::text) AS next_action,
            rc.next_action_date AS action_date,
            NULL::text AS priority,
            'recruit_candidates'::text AS source,
            rc.stage AS stage,
            rc.next_action_date - CURRENT_DATE AS days_until,
            ( SELECT max(rf.followup_date) AS max
                   FROM public.recruit_followups rf
                  WHERE rf.candidate_id = rc.id AND rf.deleted_at IS NULL) AS last_followup_date
           FROM public.recruit_candidates rc
             JOIN public.customers c4 ON c4."Id" = rc.customer_id AND c4.deleted_at IS NULL
             LEFT JOIN public.persons p4 ON p4.id = c4.person_id AND p4.deleted_at IS NULL
          WHERE rc.deleted_at IS NULL AND rc.stage <> '流失'::text AND (NULLIF(btrim(rc.next_action), ''::text) IS NOT NULL OR rc.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'recruit_followup-'::text || lr.id,
            'recruit_followup'::text AS action_type,
            'recruit'::text AS person_type,
            lr.candidate_id AS person_id,
            COALESCE(p5.display_name, c5.customer_name, '候选人#'::text || lr.candidate_id) AS person_name,
            '增员跟进 · '::text || COALESCE(p5.display_name, c5.customer_name, '候选人#'::text || lr.candidate_id) AS title,
            COALESCE(NULLIF(btrim(lr.next_action), ''::text), NULLIF(btrim(lr.interaction_summary), ''::text), NULLIF(btrim(lr.next_followup_goal), ''::text)) AS next_action,
            COALESCE(lr.next_action_date, lr.next_followup_date) AS action_date,
            NULL::text AS priority,
            'recruit_followups'::text AS source,
            rc5.stage AS stage,
            COALESCE(lr.next_action_date, lr.next_followup_date) - CURRENT_DATE AS days_until,
            lr.followup_date AS last_followup_date
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
             LEFT JOIN public.persons p5 ON p5.id = c5.person_id AND p5.deleted_at IS NULL
        UNION ALL
         SELECT 'activity_task-'::text || t.id,
            'activity_task'::text AS action_type,
            'activity'::text AS person_type,
            t.activity_id AS person_id,
            COALESCE(a.name, '活动#'::text || t.activity_id) AS person_name,
            (COALESCE(a.name, '活动#'::text || t.activity_id) || ' · '::text) || t.task_title AS title,
            COALESCE(NULLIF(btrim(t.note), ''::text), t.task_title) AS next_action,
            t.due_date AS action_date,
            t.priority AS priority,
            'activity_tasks'::text AS source,
            t.status AS stage,
            t.due_date - CURRENT_DATE AS days_until,
            NULL::date AS last_followup_date
           FROM public.activity_tasks t
             LEFT JOIN public.activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
          WHERE (t.status = ANY (ARRAY['pending'::text, 'in_progress'::text])) AND a.deleted_at IS NULL) v;

COMMENT ON VIEW public.v_action_center IS
  'PMC-10: display names from persons.display_name (COALESCE fallback to legacy customer_name); filters/order/columns unchanged';
COMMIT;
