-- Roll back the WP07.1 scoped service wrapper after reverting its callers.
DROP FUNCTION public.crm_person_only_recruit_delete_v1(text, text, bigint[]);
