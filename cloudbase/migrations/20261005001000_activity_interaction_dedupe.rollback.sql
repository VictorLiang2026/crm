-- Removes only WP12's concurrency guard; existing interactions are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS public.wp12_activity_interaction_once_idx;
COMMIT;
