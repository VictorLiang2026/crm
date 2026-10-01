-- First redeploy the previous recruit_goals cloud function; then drop this RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.crm_recruit_goals_save_v1(text,jsonb,text);

COMMIT;
