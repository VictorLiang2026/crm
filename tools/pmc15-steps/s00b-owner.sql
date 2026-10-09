SELECT to_jsonb(x) AS owner_info FROM (
  SELECT current_user AS current_user, session_user AS session_user,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_super,
    (SELECT string_agg(c.relname || ':' || pg_get_userbyid(c.relowner), ', ' ORDER BY c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('person_roles','relationships','households','household_members','customers',
        'recruit_candidates','activity_speakers','activity_participants','persons')) AS owners
) x;
