-- PC33 shape guard rollback: v1 receipts and audit data remain intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb);
COMMIT;
