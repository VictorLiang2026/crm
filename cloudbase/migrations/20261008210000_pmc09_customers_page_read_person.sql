-- PMC-09: 客户列表读取切换——基础字段从 persons 读取，经营字段从 customers 读取
-- 只修改函数体，不改变签名、权限、返回结构
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regprocedure('public.crm_customers_page_v1(integer,integer,text,text,text,date,text)') IS NULL THEN
    RAISE EXCEPTION 'public.crm_customers_page_v1 does not exist';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.crm_customers_page_v1(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_keyword text DEFAULT '',
  p_sort_field text DEFAULT 'Id',
  p_sort_dir text DEFAULT 'desc',
  p_today date DEFAULT NULL,
  p_exact_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
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

  -- PMC-09: 基础字段从 persons 读取（经 person_id JOIN），persons 无值时回退 customers
  WITH base AS (
    SELECT c."Id",
      COALESCE(p.display_name, c.customer_name) AS customer_name,
      COALESCE(p.phone, c.phone) AS phone,
      COALESCE(p.occupation, c.occupation) AS occupation,
      COALESCE(p.birthday, c.birthday) AS birthday,
      COALESCE(p.gender, c.gender) AS gender,
      c.customer_stage, c.sales_priority, c.recruitment_priority, c.referral_priority,
      c.first_contact_date, c.marital_status, c.hobbies, c.source,
      c.tags, c.annual_income, c.household_income, c.properties_info,
      c.additional_info, c.created_at, c.updated_at,
      f.followup_date AS latest_followup_date,
      f.next_followup_date,
      COALESCE(f.followup_date, c.first_contact_date,
        (c.created_at AT TIME ZONE 'UTC')::date) AS last_contact_date
    FROM public.customers c
    LEFT JOIN public.persons p ON p.id = c.person_id AND p.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT x.followup_date, x.next_followup_date
      FROM public.followups x
      WHERE x.customer_id = c."Id" AND x.deleted_at IS NULL
      ORDER BY x.followup_date DESC NULLS LAST, x."Id" DESC
      LIMIT 1
    ) f ON true
    WHERE c.deleted_at IS NULL
      AND (p_exact_name IS NULL OR lower(btrim(COALESCE(p.display_name, c.customer_name))) = lower(btrim(p_exact_name)))
      AND (btrim(p_keyword) = '' OR
        strpos(lower(COALESCE(p.display_name, c.customer_name, '')), lower(btrim(p_keyword))) > 0 OR
        strpos(COALESCE(p.phone, c.phone, ''), btrim(p_keyword)) > 0 OR
        strpos(lower(COALESCE(p.occupation, c.occupation, '')), lower(btrim(p_keyword))) > 0)
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

REVOKE ALL ON FUNCTION public.crm_customers_page_v1(integer,integer,text,text,text,date,text)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_customers_page_v1(integer,integer,text,text,text,date,text)
  TO anon, service_role;
COMMENT ON FUNCTION public.crm_customers_page_v1(integer,integer,text,text,text,date,text) IS
  'PMC-09: base fields read from persons (via person_id), fallback to customers;经营字段仍从 customers';
COMMIT;
