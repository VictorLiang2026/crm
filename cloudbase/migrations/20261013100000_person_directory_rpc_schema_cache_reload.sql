BEGIN;

-- Refresh the PostgreSQL REST/PostgREST schema cache so the existing
-- service_role-only filtered directory RPC is discoverable over HTTP.
NOTIFY pgrst, 'reload schema';

COMMIT;
