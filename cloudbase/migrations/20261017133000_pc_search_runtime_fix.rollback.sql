-- Roll back the PC24 search feature if this evidence correction must be reverted.
BEGIN;
DROP FUNCTION IF EXISTS public.crm_search_people_v2(jsonb,integer,integer);
COMMIT;
