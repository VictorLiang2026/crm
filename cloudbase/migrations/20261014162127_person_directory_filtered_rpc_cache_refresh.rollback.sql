BEGIN;

-- Cache notifications are transient; repeat the refresh to reconcile metadata after rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
