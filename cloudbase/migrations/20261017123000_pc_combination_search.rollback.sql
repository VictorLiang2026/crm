-- PC24 rollback: remove only the new read-only RPC. No business data is changed.
BEGIN;
DROP FUNCTION IF EXISTS public.crm_search_people_v2(jsonb,integer,integer);
COMMIT;
