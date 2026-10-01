-- Run only after the customers Cloud Function no longer calls this RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.crm_customers_page_v1(integer,integer,text,text,text,date,text);
COMMIT;
