BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

REVOKE ALL ON FUNCTION public.person_trash_page_v1(integer,integer,text[],text[],text[],text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_trash_page_v1(integer,integer,text[],text[],text[],text[])
  TO service_role;

COMMIT;
