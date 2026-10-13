BEGIN;

-- Cache reload is transient and has no persistent schema state to undo.
-- Re-send the notification so REST metadata is reconciled after rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
