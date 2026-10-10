-- PMC-18：观察记录表 + customers 基础字段裸写审计触发器
-- 只读观测用途，不修改业务逻辑，不删除字段
-- migration: 20261010115000_pmc18_observation_table.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. 观察记录表（仅元数据，无 PII）
CREATE TABLE IF NOT EXISTS public.pmc18_observations (
  id bigserial PRIMARY KEY,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metric text NOT NULL,
  value text,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmc18_observations_observed_at
  ON public.pmc18_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pmc18_observations_metric
  ON public.pmc18_observations(metric);

-- 2. customers 基础字段裸写审计触发器函数
-- 判断规则：pg_trigger_depth() > 1 表示经桥触发器投影（PersonService 更新 persons → 桥 → customers）
--            pg_trigger_depth() = 1 表示直接 UPDATE customers（裸写，应标记 warning）
CREATE OR REPLACE FUNCTION public.pmc18_customers_basics_audit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_via_person boolean := (pg_trigger_depth() > 1);
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name THEN v_changed := v_changed || 'customer_name'; END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN v_changed := v_changed || 'phone'; END IF;
  IF NEW.wx_account IS DISTINCT FROM OLD.wx_account THEN v_changed := v_changed || 'wx_account'; END IF;
  IF NEW.gender IS DISTINCT FROM OLD.gender THEN v_changed := v_changed || 'gender'; END IF;
  IF NEW.birthday IS DISTINCT FROM OLD.birthday THEN v_changed := v_changed || 'birthday'; END IF;
  IF NEW.occupation IS DISTINCT FROM OLD.occupation THEN v_changed := v_changed || 'occupation'; END IF;
  IF NEW.education IS DISTINCT FROM OLD.education THEN v_changed := v_changed || 'education'; END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pmc18_observations(observed_at, metric, value, level, detail)
  VALUES (
    now(),
    'customers_basics_update',
    'via_person_service=' || v_via_person::text,
    CASE WHEN v_via_person THEN 'info' ELSE 'warning' END,
    jsonb_build_object(
      'customer_id', NEW."Id",
      'changed_fields', v_changed,
      'trigger_depth', pg_trigger_depth()
    )
  );
  RETURN NEW;
END;
$$;

-- 3. 审计触发器（AFTER UPDATE OF 基础 7 字段）
DROP TRIGGER IF EXISTS pmc18_customers_basics_audit ON public.customers;
CREATE TRIGGER pmc18_customers_basics_audit
  AFTER UPDATE OF customer_name, phone, wx_account, gender, birthday, occupation, education
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.pmc18_customers_basics_audit_fn();

-- 4. 授权：service_role 可读写观测表（云函数采集写入），anon 只读
-- authenticated 通过 RLS 策略 pmc18_obs_read 获得 SELECT，不直接 GRANT
GRANT SELECT, INSERT ON public.pmc18_observations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pmc18_observations_id_seq TO service_role;
GRANT SELECT ON public.pmc18_observations TO anon;

-- 4b. RLS：service_role 全权限，anon/authenticated 只读
ALTER TABLE public.pmc18_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmc18_obs_service_all ON public.pmc18_observations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pmc18_obs_read ON public.pmc18_observations
  FOR SELECT TO anon, authenticated USING (true);

-- 5. 指标采集函数（供 pmc18_observer 云函数调用）
-- 返回 JSON 快照，含全部观察指标；只读，无 PII
CREATE OR REPLACE FUNCTION public.pmc18_collect_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH counts AS (
    SELECT 'persons'::text AS t, count(*)::int AS total,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted FROM public.persons
    UNION ALL SELECT 'customers', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.customers
    UNION ALL SELECT 'recruit_candidates', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.recruit_candidates
    UNION ALL SELECT 'activity_participants', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.activity_participants
    UNION ALL SELECT 'opportunities', count(*)::int, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int FROM public.opportunities
  ),
  mappings AS (
    SELECT
      (SELECT count(*)::int FROM public.customers WHERE deleted_at IS NULL) AS active_customers,
      (SELECT count(*)::int FROM public.customers WHERE deleted_at IS NULL AND person_id IS NULL) AS customers_without_person,
      (SELECT count(*)::int FROM public.recruit_candidates WHERE deleted_at IS NULL) AS active_recruits,
      (SELECT count(*)::int FROM public.recruit_candidates WHERE deleted_at IS NULL AND person_id IS NULL) AS recruits_without_person
  ),
  field_drift AS (
    SELECT count(*)::int AS drift_rows FROM public.customers c
    JOIN public.persons p ON c.person_id = p.id
    WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL
      AND (
        COALESCE(c.customer_name,'') <> COALESCE(p.display_name,'')
        OR COALESCE(c.phone,'') <> COALESCE(p.phone,'')
        OR COALESCE(c.wx_account,'') <> COALESCE(p.wechat,'')
        OR COALESCE(c.gender,'') <> COALESCE(p.gender,'')
        OR COALESCE(c.birthday::text,'') <> COALESCE(p.birthday::text,'')
        OR COALESCE(c.occupation,'') <> COALESCE(p.occupation,'')
        OR COALESCE(c.education,'') <> COALESCE(p.education,'')
      )
  ),
  duplicate_persons AS (
    SELECT count(*)::int AS dup_groups FROM (
      SELECT p.display_name, p.phone
      FROM public.persons p
      WHERE p.deleted_at IS NULL AND p.phone IS NOT NULL AND p.phone <> ''
      GROUP BY p.display_name, p.phone HAVING count(*) > 1
    ) d
  ),
  orphans AS (
    SELECT
      (SELECT count(*)::int FROM public.recruit_candidates rc LEFT JOIN public.persons p ON rc.person_id=p.id WHERE rc.person_id IS NOT NULL AND p.id IS NULL) AS recruit_person_id,
      (SELECT count(*)::int FROM public.opportunities o LEFT JOIN public.persons p ON o.person_id=p.id WHERE o.person_id IS NOT NULL AND p.id IS NULL) AS opportunity_person_id,
      (SELECT count(*)::int FROM public.activity_participants ap LEFT JOIN public.persons p ON ap.person_id=p.id WHERE ap.person_id IS NOT NULL AND p.id IS NULL) AS participant_person_id,
      (SELECT count(*)::int FROM public.interactions i LEFT JOIN public.persons p ON i.person_id=p.id WHERE i.person_id IS NOT NULL AND p.id IS NULL) AS interaction_person_id,
      (SELECT count(*)::int FROM public.followups f LEFT JOIN public.customers c ON f.customer_id=c."Id" WHERE f.customer_id IS NOT NULL AND c."Id" IS NULL) AS followup_customer_id,
      (SELECT count(*)::int FROM public.gifts g LEFT JOIN public.customers c ON g.customer_id=c."Id" WHERE g.customer_id IS NOT NULL AND c."Id" IS NULL) AS gift_customer_id,
      (SELECT count(*)::int FROM public.products pr LEFT JOIN public.customers c ON pr.customer_id=c."Id" WHERE pr.customer_id IS NOT NULL AND c."Id" IS NULL) AS product_customer_id
  ),
  softdelete_cross AS (
    SELECT
      (SELECT count(*)::int FROM public.persons p JOIN public.customers c ON p.legacy_customer_id=c."Id" WHERE p.deleted_at IS NULL AND c.deleted_at IS NOT NULL) AS person_alive_customer_deleted,
      (SELECT count(*)::int FROM public.persons p JOIN public.customers c ON p.legacy_customer_id=c."Id" WHERE p.deleted_at IS NOT NULL AND c.deleted_at IS NULL) AS person_deleted_customer_alive
  ),
  roles AS (
    SELECT count(*)::int AS duplicate_role_rows FROM (
      SELECT person_id, role FROM public.person_roles GROUP BY person_id, role HAVING count(*) > 1
    ) d
  ),
  no_role AS (
    SELECT count(*)::int AS no_role FROM public.persons p
    WHERE p.deleted_at IS NULL
      AND p.display_name NOT LIKE '【系统测试%'
      AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id = p.id)
  )
  SELECT jsonb_build_object(
    'version', 'pmc18-metrics-v1',
    'environment', 'crm-d1gkae8ddc930d151',
    'observedAt', CURRENT_TIMESTAMP,
    'counts', (SELECT jsonb_object_agg(t, jsonb_build_object('total', total, 'softDeleted', soft_deleted)) FROM counts),
    'mappings', (SELECT to_jsonb(m.*) FROM mappings m),
    'field_drift', (SELECT to_jsonb(f.*) FROM field_drift f),
    'duplicate_persons', (SELECT to_jsonb(d.*) FROM duplicate_persons d),
    'orphans', (SELECT to_jsonb(o.*) FROM orphans o),
    'softdelete_cross', (SELECT to_jsonb(s.*) FROM softdelete_cross s),
    'roles', (SELECT to_jsonb(r.*) FROM roles r),
    'no_role', (SELECT to_jsonb(n.*) FROM no_role n)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pmc18_collect_metrics() TO service_role;
REVOKE EXECUTE ON FUNCTION public.pmc18_collect_metrics() FROM PUBLIC, anon, authenticated;

COMMIT;
