-- Manual rollback: only removes the new read-only search function.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.crm_search_people_v1(text,integer,integer) RESTRICT;
COMMIT;
