-- Read-only WP07.1 production contract. Run only against public after migration.
SELECT 'persons' AS object, count(*) AS rows FROM public.persons
UNION ALL SELECT 'customers',count(*) FROM public.customers
UNION ALL SELECT 'recruit_candidates',count(*) FROM public.recruit_candidates
UNION ALL SELECT 'person_only_recruit',count(*) FROM public.recruit_candidates WHERE customer_id IS NULL;

SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN (
  'person_identity_commands','v_recruit_candidates_person_only',
  'v_recruit_candidates_person_only_trash')
ORDER BY table_name,grantee,privilege_type;
