-- Manual rollback removes only the V2 RPC. Existing confirmed writes remain intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.quick_capture_v2_commit(bigint, text, text, jsonb, jsonb, jsonb) RESTRICT;
COMMIT;
