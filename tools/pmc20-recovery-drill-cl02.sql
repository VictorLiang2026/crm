-- PMC-20 recovery drill (read-only): simulate the CL-02 rollback backfill coverage that
-- would run if the 7 customers columns were restored. Every value comes from persons via
-- customers.person_id, so coverage proves the rollback restores real values, not empty
-- columns - including for customers created AFTER the cleanup.
WITH joined AS (
  SELECT c."Id" AS customer_id, c.deleted_at AS cust_del,
         p.id AS person_id,
         (p.display_name IS NOT NULL) AS has_name,
         (p.phone IS NOT NULL AND btrim(p.phone) <> '') AS has_phone,
         (p.birthday IS NOT NULL) AS has_birthday,
         (p.gender IS NOT NULL AND btrim(p.gender) <> '') AS has_gender,
         (p.occupation IS NOT NULL AND btrim(p.occupation) <> '') AS has_occupation,
         (p.education IS NOT NULL AND btrim(p.education) <> '') AS has_education,
         (p.wechat IS NOT NULL AND btrim(p.wechat) <> '') AS has_wechat
  FROM public.customers c
  LEFT JOIN public.persons p ON p.id = c.person_id
)
SELECT count(*) AS customers_total,
       count(*) FILTER (WHERE person_id IS NOT NULL) AS link_covered,
       count(*) FILTER (WHERE person_id IS NULL) AS link_missing,
       count(*) FILTER (WHERE has_name) AS name_nonempty,
       count(*) FILTER (WHERE has_phone) AS phone_nonempty,
       count(*) FILTER (WHERE has_birthday) AS birthday_nonempty,
       count(*) FILTER (WHERE has_gender) AS gender_nonempty,
       count(*) FILTER (WHERE has_occupation) AS occupation_nonempty,
       count(*) FILTER (WHERE has_education) AS education_nonempty,
       count(*) FILTER (WHERE has_wechat) AS wechat_nonempty,
       count(*) FILTER (WHERE cust_del IS NOT NULL) AS soft_deleted_customers
FROM joined;
