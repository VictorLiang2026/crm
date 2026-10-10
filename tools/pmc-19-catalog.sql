-- PMC-19 cleanup candidate catalog (read-only)
-- Verifies current state of all cleanup candidates in public schema
WITH

-- C1: customers 客户列表_姓名_key UNIQUE constraint (D5)
c1_constraint AS (
  SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = connamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'customers'
    AND con.contype IN ('u','p','f')
  ORDER BY con.conname
),

-- C2: customers.person_id column + constraints
c2_person_id AS (
  SELECT a.attname, a.attnotnull, format_type(a.atttypid,a.atttypmod) AS type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='customers' AND a.attname='person_id' AND a.attnum>0
),

-- C3: persons.legacy_customer_id column + unique
c3_legacy AS (
  SELECT a.attname, a.attnotnull, format_type(a.atttypid,a.atttypmod) AS type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='persons' AND a.attname='legacy_customer_id' AND a.attnum>0
),

-- C4: composite FK on opportunities / recruit_candidates referencing persons(legacy_customer_id,id)
c4_composite_fk AS (
  SELECT con.conname, cl.relname AS child_table, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=con.connamespace
  WHERE n.nspname='public' AND con.contype='f'
    AND cl.relname IN ('opportunities','recruit_candidates')
    AND pg_get_constraintdef(con.oid) ILIKE '%legacy_customer_id%'
),

-- C5: customers base 7 copy columns existence
c5_copy_cols AS (
  SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='customers'
    AND a.attname IN ('customer_name','phone','birthday','gender','occupation','education','wx_account')
    AND a.attnum>0
  ORDER BY a.attname
),

-- C6: recruit_candidates dead columns (education/mbti) - non-null count
c6_recruit_dead AS (
  SELECT
    count(*) AS total_rows,
    count(education) AS education_non_null,
    count(mbti) AS mbti_non_null
  FROM public.recruit_candidates
),

-- C7: recruit_candidates attnum gaps (pos 3-9, 14, 20)
c7_attnum_gaps AS (
  SELECT a.attnum, a.attname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='recruit_candidates' AND a.attnum>0
  ORDER BY a.attnum
),

-- C8: triggers - bridge + sync
c8_triggers AS (
  SELECT tg.tgname, c.relname AS table_name, pg_get_triggerdef(tg.oid) AS def
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid=tg.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND (tg.tgname ILIKE '%bridge%' OR tg.tgname ILIKE '%sync%' OR tg.tgname ILIKE '%person%identity%' OR tg.tgname ILIKE '%recruit_candidate_person%')
    AND NOT tg.tgisinternal
  ORDER BY tg.tgname
),

-- C9: views that reference customer base copy columns
c9_views AS (
  SELECT DISTINCT c.relname AS view_name
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
  JOIN pg_class rc ON rc.oid=a.attrelid
  JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE n.nspname='public' AND c.relkind='v'
    AND rn.nspname='public' AND rc.relname='customers'
    AND a.attname IN ('customer_name','phone','birthday','gender','occupation','education','wx_account')
),

-- C10: data counts for decision basis
c10_counts AS (
  SELECT
    (SELECT count(*) FROM public.persons) AS persons_total,
    (SELECT count(*) FROM public.persons WHERE deleted_at IS NULL) AS persons_active,
    (SELECT count(*) FROM public.customers) AS customers_total,
    (SELECT count(*) FROM public.customers WHERE deleted_at IS NULL) AS customers_active,
    (SELECT count(*) FROM public.customers WHERE person_id IS NOT NULL) AS customers_with_person,
    (SELECT count(*) FROM public.customers WHERE person_id IS NULL) AS customers_without_person,
    (SELECT count(*) FROM public.opportunities) AS opportunities_total,
    (SELECT count(*) FROM public.recruit_candidates) AS recruit_total,
    (SELECT count(*) FROM public.persons WHERE legacy_customer_id IS NOT NULL) AS persons_with_legacy
),

-- C11: duplicate customer_name check (D5 pre-condition)
c11_dup_names AS (
  SELECT customer_name, count(*) AS cnt
  FROM public.customers
  WHERE deleted_at IS NULL
  GROUP BY customer_name
  HAVING count(*) > 1
  ORDER BY cnt DESC
  LIMIT 10
),

-- C12: recruit_candidates person_id NOT NULL status
c12_recruit_pid AS (
  SELECT
    count(*) AS total,
    count(person_id) AS person_id_non_null,
    count(customer_id) AS customer_id_non_null,
    count(*) FILTER (WHERE person_id IS NULL) AS person_id_null
  FROM public.recruit_candidates
)

SELECT json_build_object(
  'c1_constraints', (SELECT json_agg(c1_constraint) FROM c1_constraint),
  'c2_customers_person_id', (SELECT to_json(c2_person_id) FROM c2_person_id),
  'c3_persons_legacy_customer_id', (SELECT to_json(c3_legacy) FROM c3_legacy),
  'c4_composite_fk', (SELECT json_agg(c4_composite_fk) FROM c4_composite_fk),
  'c5_customers_copy_cols', (SELECT json_agg(c5_copy_cols) FROM c5_copy_cols),
  'c6_recruit_dead_cols', (SELECT to_json(c6_recruit_dead) FROM c6_recruit_dead),
  'c7_recruit_attnum_map', (SELECT json_agg(c7_attnum_gaps) FROM c7_attnum_gaps),
  'c8_triggers', (SELECT json_agg(c8_triggers) FROM c8_triggers),
  'c9_views_reading_copy_cols', (SELECT json_agg(c9_views) FROM c9_views),
  'c10_counts', (SELECT to_json(c10_counts) FROM c10_counts),
  'c11_duplicate_active_names', (SELECT json_agg(c11_dup_names) FROM c11_dup_names),
  'c12_recruit_person_id_status', (SELECT to_json(c12_recruit_pid) FROM c12_recruit_pid)
) AS snapshot;
