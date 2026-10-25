fixture_persons AS (
 SELECT n::bigint id, 'Fixture '||n display_name, NULL::timestamptz updated_at,
 '关系维护'::text customer_stage,'A'::text sales_priority,'B'::text referral_priority,
 CASE WHEN n=38 THEN NULL ELSE DATE '2026-10-24' END first_contact_date,
 CASE WHEN n=40 THEN now() ELSE NULL::timestamptz END deleted_at
 FROM generate_series(1,40)n
), fixture_customers AS (
 SELECT n "Id",n::bigint person_id,NULL::timestamptz created_at,NULL::timestamptz deleted_at
 FROM generate_series(1,40)n WHERE n<>39
), fixture_person_roles AS (
 SELECT n::bigint person_id,'customer'::text role FROM generate_series(1,40)n
 UNION ALL SELECT 1,'recruit'
), fixture_recruit_candidates AS (
 SELECT 1::bigint id,1::bigint person_id,1::bigint customer_id,'邀约面谈'::text stage,'A'::text recruitment_priority,NULL::timestamptz deleted_at
 UNION ALL SELECT 2,2,2,'已签约','B',now()
), fixture_followups AS (
 SELECT n "Id",n customer_id,DATE '2026-10-24' followup_date,
 CASE WHEN n<=31 THEN DATE '2026-10-25'-n WHEN n=32 THEN DATE '2026-10-25'
 WHEN n=33 THEN DATE '2026-11-24' WHEN n=34 THEN DATE '2026-11-25' ELSE NULL::date END next_followup_date,
 NULL::timestamptz deleted_at FROM generate_series(1,34)n
 UNION ALL SELECT 100,35,DATE '2026-09-25',NULL,NULL
 UNION ALL SELECT 101,36,DATE '2026-09-26',NULL,NULL
 UNION ALL SELECT 102,37,NULL,NULL,NULL
 UNION ALL SELECT 103,1,DATE '2026-10-25',DATE '2026-10-30',now()
)
