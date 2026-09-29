-- Read-only production verification. All references stay in public.
SELECT
  count(*) AS candidates,
  count(*) FILTER (WHERE rc.person_id IS NULL) AS missing_person_id,
  count(*) FILTER (WHERE p.id IS NULL OR p.legacy_customer_id <> rc.customer_id)
    AS incorrect_person_link,
  count(*) FILTER (WHERE rc.deleted_at IS NULL AND p.deleted_at IS NOT NULL)
    AS active_candidate_with_deleted_person
FROM public.recruit_candidates AS rc
LEFT JOIN public.persons AS p ON p.id = rc.person_id;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('recruit_candidates', 'v_recruit_candidates', 'v_recruit_candidates_trash')
  AND column_name IN ('person_id', 'stage', 'motivation', 'concerns',
                      'potential_score', 'career_plan', 'profile')
ORDER BY table_name, column_name;

SELECT c.relname, c.reloptions, c.relrowsecurity
FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('recruit_candidates', 'v_recruit_candidates',
                    'v_recruit_candidates_trash');

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.recruit_candidates'::regclass
  AND conname IN ('recruit_candidates_person_fk',
                  'recruit_candidates_customer_person_fk');
