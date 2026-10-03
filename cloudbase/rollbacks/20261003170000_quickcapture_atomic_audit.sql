-- WP07: remove only the atomic plan wrapper; receipts and business rows remain intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.quick_capture_v2_plan_v1(text,bigint,text,jsonb,bigint,bigint) RESTRICT;
COMMIT;
