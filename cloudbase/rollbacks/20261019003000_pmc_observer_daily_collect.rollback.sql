-- Deploy the previous pmc18_observer first. This rollback does not delete observations.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.pmc18_collect_once_v1();
COMMIT;
