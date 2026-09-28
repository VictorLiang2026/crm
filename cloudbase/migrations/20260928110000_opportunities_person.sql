-- Extend opportunities with Person identity while keeping legacy customer opportunities visible.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'opportunities'
               AND column_name = 'person_id') THEN
    RAISE EXCEPTION 'public.opportunities.person_id already exists; inspect before migrating';
  END IF;
END;
$guard$;

ALTER TABLE public.opportunities ADD COLUMN person_id bigint;
ALTER TABLE public.opportunities ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_identity_required
  CHECK (customer_id IS NOT NULL OR person_id IS NOT NULL);
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_person_fk
  FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE RESTRICT;
ALTER TABLE public.persons
  ADD CONSTRAINT persons_legacy_customer_id_id_unique UNIQUE (legacy_customer_id, id);
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_customer_person_fk
  FOREIGN KEY (customer_id, person_id)
  REFERENCES public.persons(legacy_customer_id, id) MATCH SIMPLE ON DELETE RESTRICT;
UPDATE public.opportunities AS o SET person_id = p.id
FROM public.persons AS p
WHERE o.customer_id = p.legacy_customer_id AND o.person_id IS NULL;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.opportunities WHERE person_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy opportunity Person mapping incomplete';
  END IF;
END;
$guard$;
CREATE INDEX opportunities_person_active_idx
  ON public.opportunities(person_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND person_id IS NOT NULL;

-- Existing anonymous function path sees only customer-linked rows.
ALTER POLICY opportunities_fn_only ON public.opportunities
  USING (
    customer_id IS NOT NULL
    AND (current_setting('request.jwt.claims', true)::json ->> 'sub') IS NULL
    AND (current_setting('request.jwt.claims', true)::json ->> 'role') = 'anon'
  )
  WITH CHECK (
    customer_id IS NOT NULL
    AND (current_setting('request.jwt.claims', true)::json ->> 'sub') IS NULL
    AND (current_setting('request.jwt.claims', true)::json ->> 'role') = 'anon'
  );
CREATE POLICY opportunities_service_only ON public.opportunities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rebuild both dependent views with the same output columns and invoker security.
-- The explicit customer_id filter protects legacy action/funnel semantics for all roles.
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

CREATE OR REPLACE FUNCTION public.actions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $guard$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.person_id, NEW.opportunity_id, NEW.interaction_id, NEW.activity_id,
        NEW.source, NEW.created_by_uid, NEW.confirmed_by_uid, NEW.confirmed_at)
       IS DISTINCT FROM
       (OLD.person_id, OLD.opportunity_id, OLD.interaction_id, OLD.activity_id,
        OLD.source, OLD.created_by_uid, OLD.confirmed_by_uid, OLD.confirmed_at) THEN
      RAISE EXCEPTION 'action identity, links and provenance are immutable'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.interaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interactions AS i
    WHERE i.id = NEW.interaction_id AND i.person_id = NEW.person_id
  ) THEN
    RAISE EXCEPTION 'action interaction belongs to another Person'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.opportunities AS o
    JOIN public.persons AS p ON p.id = NEW.person_id
    WHERE o.id = NEW.opportunity_id AND
      (o.person_id = NEW.person_id OR o.customer_id = p.legacy_customer_id)
  ) THEN
    RAISE EXCEPTION 'action opportunity belongs to another Person'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard$;
COMMENT ON COLUMN public.opportunities.person_id IS
  'Unified Person identity; nullable on future legacy customer-only writes';
COMMENT ON COLUMN public.opportunities.opportunity_type IS
  'Legacy Chinese types plus insurance/recruit/referral/activity/speaker/partnership/service/relationship';
COMMIT;
