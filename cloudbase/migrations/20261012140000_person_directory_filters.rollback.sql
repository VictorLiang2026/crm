BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

REVOKE ALL ON FUNCTION public.person_directory_filtered_page_v1(integer,integer,text,text,text,text[],text[],text[],text[])
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.person_directory_filtered_page_v1(integer,integer,text,text,text,text[],text[],text[],text[]);

COMMIT;
