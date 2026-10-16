BEGIN;

-- A cache refresh is harmless on rollback and keeps prior RPCs discoverable.
NOTIFY pgrst, 'reload schema';

COMMIT;
