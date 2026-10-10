-- Pre-check for CL-04: verify composite FKs exist, person_id NOT NULL, all person_id values valid
WITH checks AS (
  SELECT
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'opportunities_customer_person_fk' AND table_schema = 'public') AS opp_composite_fk,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'recruit_candidates_customer_person_fk' AND table_schema = 'public') AS rc_composite_fk,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'opportunities_person_fk' AND table_schema = 'public') AS opp_person_fk_exists,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'recruit_candidates_person_fk' AND table_schema = 'public') AS rc_person_fk_exists,
    (SELECT count(*) FROM public.opportunities WHERE person_id IS NULL) AS opp_null_person,
    (SELECT count(*) FROM public.recruit_candidates WHERE person_id IS NULL) AS rc_null_person,
    (SELECT count(*) FROM public.opportunities o LEFT JOIN public.persons p ON o.person_id = p.id WHERE p.id IS NULL) AS opp_orphan_person,
    (SELECT count(*) FROM public.recruit_candidates rc LEFT JOIN public.persons p ON rc.person_id = p.id WHERE p.id IS NULL) AS rc_orphan_person,
    (SELECT count(*) FROM public.opportunities) AS opp_total,
    (SELECT count(*) FROM public.recruit_candidates) AS rc_total
)
SELECT * FROM checks;
